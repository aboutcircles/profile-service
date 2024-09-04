# Pinning Service API

This API provides a service for pinning and retrieving profiles (name, description, image) to and from an IPFS node. The API includes endpoints for pinning new data, retrieving profiles by their IPFS CID, and performing health checks. Caching and blacklisting mechanisms are used to optimize performance and prevent misuse.

## API Endpoints

### 1. `GET /get`

Retrieve a single profile using its IPFS CID.

- **Query Parameters**:
    - `cid` (string, required): The CID of the profile to retrieve.

- **Response**:
    - `200 OK`: Returns the profile data as a JSON object.
    - `400 Bad Request`: If the CID is invalid or blacklisted.
    - `500 Internal Server Error`: If the profile cannot be retrieved or parsed.

### 2. `GET /getBatch`

Retrieve multiple profiles in a single request by passing an array of CIDs.

- **Query Parameters**:
    - `cids` (string, required): A comma-separated list of CIDs to fetch.

- **Response**:
    - `200 OK`: Returns an array of profile data for each valid CID.
    - `400 Bad Request`: If no CIDs are provided, or the batch exceeds the maximum size (default 50).
    - `500 Internal Server Error`: If fetching the profiles fails.

### 3. `POST /pin`

Pin a new profile to IPFS.

- **Request Body**: A JSON object representing the profile data to be pinned:
    - `name` (string, required): The profile's name (max length: 36 characters).
    - `description` (string, optional): A description of the profile (max length: 500 characters).
    - `previewImageUrl` (string, optional): A base64-encoded preview image (256x256 pixels, max size: 150KB).
    - `imageUrl` (string, optional): A URL for the profile's image (max length: 2000 characters).

- **Response**:
    - `200 OK`: Returns the CID of the pinned profile.
    - `400 Bad Request`: If the profile fails validation.
    - `500 Internal Server Error`: If the profile cannot be pinned.

### 4. `GET /health`

Check the health of the service.

- **Response**:
    - `200 OK`: If the IPFS node is reachable and the service is healthy.
    - `500 Internal Server Error`: If the IPFS node cannot be accessed.

## Error Handling

- **400 Bad Request**: Indicates invalid input, such as missing or incorrect CIDs or profile data.
- **500 Internal Server Error**: Indicates server errors, such as issues connecting to IPFS or parsing data.

## Caching and Blacklisting

- **Caching**: Profiles are cached using an LRU cache for faster retrieval.
- **Blacklisting**: CIDs that fail validation are blacklisted to prevent repeated invalid requests.
