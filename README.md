# Circles Profile Service

This service indexes and persists profile data from/to IPFS (or via a s3 compatible pinning service if configured). 
It supports retrieving single or multiple profiles by CID, searching profiles by various fields, and basic health checks.

## Table of Contents

- [Overview](#overview)
- [Endpoints](#endpoints)
  - [`GET /get`](#get-get)
  - [`GET /getBatch`](#get-getbatch)
  - [`POST /pin`](#post-pin)
  - [`GET /search`](#get-search)
  - [`GET /health`](#get-health)
- [Options](#options)
  - [Caching](#caching)
  - [Blacklisting](#blacklisting)
  - [Reorg Handling](#reorg-handling)
- [Validation Rules](#validation-rules)
- [Environment Variables / Configuration](#environment-variables--configuration)

---

## Overview

Profiles include:
- **name** (required)
- **description** (optional)
- **previewImageUrl** (optional, base64-encoded image)
- **imageUrl** (optional, regular URL)

When you `GET` a profile by its CID, the API will fetch and cache it (if not already cached). If the data fails validation or is too large, the CID is blacklisted and subsequent requests for that CID will fail with a `400 Bad Request`.

**Note:** The service can run either with a local Kubo IPFS node (`kubo-rpc-client`) or via an S3-based pinning service (like Filebase). This is controlled by environment variables (particularly `USE_S3`).

---

## Endpoints

### `GET /get`

**Retrieve a single profile by CID.**

- **Query Parameters**
  - `cid` (string, required): The IPFS CID of the profile to retrieve.

- **Responses**
  - **200 OK**: The profile data in JSON.
  - **400 Bad Request**: If the CID is missing, invalid, or blacklisted.
  - **500 Internal Server Error**: If retrieval or parsing fails.

---

### `GET /getBatch`

**Retrieve multiple profiles in one request.**

- **Query Parameters**
  - `cids` (string, required): A comma-separated list of CIDs, e.g. `Qm123,Qm456,...`.

- **Responses**
  - **200 OK**: An array of profile data, in the same order as requested. If any CID fails, its result will be `null`.
  - **400 Bad Request**: If `cids` is missing, the list is empty, or if it exceeds the maximum allowed (default 50).
  - **500 Internal Server Error**: If anything goes wrong while fetching the profiles.

---

### `POST /pin`

**Pin a new profile.**

- **Request Body** (JSON):
  - `name` (string, required; max 36 chars)
  - `description` (string, optional; max 500 chars)
  - `previewImageUrl` (string, optional; base64-encoded 256x256 image, max ~150KB)
  - `imageUrl` (string, optional; regular URL, max 2000 chars)

- **Responses**
  - **200 OK**: Returns a JSON object like `{ "cid": "..." }`, where `"..."` is the resulting IPFS CID.
  - **400 Bad Request**: If the request fails validation (e.g., missing `name`, image too large, etc.).
  - **500 Internal Server Error**: If there's an internal error pinning or storing the file.

---

### `GET /search`

**Search profiles by various fields.**

- **Query Parameters**: At least one of the following:
  - `name`: partial text match (case-insensitive) in `name`.
  - `description`: partial text match in `description`.
  - `address`: exact match on the profile’s blockchain address.
  - `CID`: exact match on the stored IPFS CID.
  - `registeredName`: exact match on the profile’s short/registered name from the chain.

When multiple parameters are provided, all of them are combined with a logical "AND".

- **Responses**
  - **200 OK**: Returns an array of matching profiles, each with `name`, `description`, `address`, `CID`, `lastUpdatedAt`, and `registeredName`.
  - **400 Bad Request**: If no parameters are provided or if they fail basic validation.
  - **500 Internal Server Error**: If something goes wrong searching the DB.

**Note:** Searching by `name` or `description` will do a "contains" match. Fields like `address`, `CID`, and `registeredName` must match exactly.

---

### `GET /health`

**Check if the service is up and running.**

- **Responses**
  - **200 OK**: Service is healthy, IPFS (or S3) is reachable.
  - **500 Internal Server Error**: If the IPFS node or pinning service is unreachable.

---
## Examples (cURL)

Below are a few sample cURL requests to illustrate how to interact with this service. Change the host/port as necessary.

### GET a single profile
```bash
curl -X GET "http://localhost:3000/get?cid=Qm123abc..."
```
**Response (200)**
```json
{
  "name": "Sample Profile",
  "description": "Just a test",
  "imageUrl": "https://example.com/image.png",
  "previewImageUrl": "data:image/png;base64,..."
}
```

### GET multiple profiles
```bash
curl -X GET "http://localhost:3000/getBatch?cids=Qm123abc...,Qm789def..."
```
**Response (200)**
```json
[
  {
    "name": "Profile 1",
    "description": "...",
    "imageUrl": "https://...",
    "previewImageUrl": "data:image/png;base64,..."
  },
  {
    "name": "Profile 2",
    "description": "...",
    "imageUrl": null,
    "previewImageUrl": null
  }
]
```

### POST a new profile to be pinned
```bash
curl -X POST "http://localhost:3000/pin" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "MyProfile",
    "description": "This is a test profile",
    "previewImageUrl": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA...",
    "imageUrl": "https://example.com/myimage.jpg"
  }'
```
**Response (200)**
```json
{
  "cid": "Qm123abc..."
}
```

### GET a health check
```bash
curl -X GET "http://localhost:3000/health"
```
**Response (200)**
```json
{
  "status": "ok"
}
```

### GET a search for a name
```bash
curl -X GET "http://localhost:3000/search?name=alice"
```
**Response (200)**
```json
[
  {
    "name": "AliceInCircles",
    "description": "Just Alice's profile",
    "address": "0x123...",
    "CID": "Qm123abc...",
    "lastUpdatedAt": 12345678,
    "registeredName": "alice" 
  }
]
```

---

## Options

### Caching

An in-memory [LRU cache](https://github.com/isaacs/node-lru-cache) is used for storing fetched profiles. This helps speed up repeated requests. The maximum cache size can be configured via environment variables (see below).

### Blacklisting

If a profile fails validation (e.g., invalid JSON, malicious content, or exceeding size limits), its CID is blacklisted in an LRU cache. Subsequent requests for that CID will automatically return a `400 Bad Request` without re-fetching from IPFS.

### Reorg Handling

Because this service also monitors Circles (Gnosis chain) contract events, there's code to handle chain reorgs up to a certain depth (default 12 blocks). If a reorg is detected, it:
1. Deletes recently updated profile records from the DB.
2. Re-fetches events from the chain for those blocks.
3. Re-applies new or changed events to keep the indexing consistent.

## Validation Rules

- **`name`**: Required, up to 36 characters.
- **`description`**: Optional, up to 500 characters.
- **`previewImageUrl`**: Must be a valid base64-encoded image. Limited to 256×256 px and ~150KB.
- **`imageUrl`**: Must be an HTTP/HTTPS URL (max length 2000 chars).
- **Overall Profile**: Total size limit is enforced. JSON is parsed; any unexpected or malicious data triggers blacklisting.

## Environment Variables / Configuration

Key environment variables that affect runtime:

- **`PORT`**: Port number (default `3000`).
- **`RPC_ENDPOINT`**: For reading chain events (Gnosis/Circles).
- **`DATABASE_PATH`**: Path to the local SQLite file (required).
- **`IPFS_HOST`, `IPFS_PORT`, `IPFS_PROTOCOL`**: For local IPFS node usage (defaults to `localhost:5001/http`).
- **`MAX_IMAGE_SIZE_KB`**: Maximum allowed size for base64 images (default `150`).
- **`DESCRIPTION_LENGTH`**: Max description chars (default `500`).
- **`IMAGE_DIMENSION`**: For the `previewImageUrl` dimension check (default `256`).
- **`MAX_NAME_LENGTH`**: Default `36`.
- **`MAX_BATCH_SIZE`**: Default `50`.
- **`CACHE_MAX_SIZE`**: LRU Cache size for profiles (default `25000`).
- **`USE_S3`**: If `true`, uses a pinning service flow instead of local IPFS (`s3Key`, `s3Secret`, `s3Bucket`, and `ipfsGateway` must be set).
- **`S3_API_URL`, `S3_KEY`, `S3_SECRET`, `S3_BUCKET`**: Credentials for the pinning service (Filebase or similar).
- **`IPFS_GATEWAY`**: Gateway URL for fetching CIDs when `USE_S3 = true`.
- **`DEFAULT_TIMEOUT`**: Request timeout in ms (default is `1000`).
