# **Specification: Linked Custom Data in User Profiles for Circles**

### Overview

This specification outlines how custom data can be securely added, verified, and encrypted in Circles user profiles. Both applications and users can add custom data links to a profile, and each link (containing multiple properties) must be signed as a whole. The profile maintains a history of public keys to verify the signatures, ensuring data integrity. Data can also be optionally encrypted for privacy, and custom data can be identified by a `name` field, which ensures that links with the same name are replaced when updated.

### 1. **User Profile Structure**

User profiles are stored as JSON documents in IPFS. They contain basic information, references to application-specific or user-specific custom data, and a history of public keys used for signature verification.

**Profile Example:**

```json
{
  "previewImageUrl": "<data url or IPFS CID>",
  "name": "<string>",
  "description": "<string>",
  "signingKeys": {
    "0xKeyFingerprint1": {
      "publicKey": "<public key>",
      "validFrom": "<timestamp>",
      "validTo": "<timestamp or null>",
      "revokedAt": "<timestamp or null>"
    },
    "0xKeyFingerprint2": {
      "publicKey": "<public key>",
      "validFrom": "<timestamp>",
      "validTo": "<timestamp or null>",
      "revokedAt": "<timestamp or null>"
    }
  },
  "customDataLinks": {
    "<app1CirclesAddress>": [
      {
        "name": "preferences",
        "cid": "QmXyz12345...",
        "encrypted": false,
        "encryptionKeyFingerprint": null,
        "signature": "<signature>"
      }
    ],
    "<userAddress>": [
      {
        "name": "personalNotes",
        "cid": "QmUser12345...",
        "encrypted": true,
        "encryptionKeyFingerprint": "0xabcdef...",
        "signature": "<signature>"
      }
    ]
  }
}
```

- `previewImageUrl`: Data URL or IPFS CID for a profile image.
- `name`: User’s chosen name.
- `description`: Short description of the user.
- `signingKeys`: A history of the user’s public keys, indexed by key fingerprint, used to verify signatures for custom data and links.
    - `publicKey`: The public key in use for signature verification.
    - `validFrom`: The timestamp when the key became valid.
    - `validTo`: The timestamp when the key expires (or `null` if it doesn't expire).
    - `revokedAt`: The timestamp when the key was revoked (or `null` if not revoked).
- `customDataLinks`: A dictionary where the keys are Circles addresses (organization or user), each mapping to an array of named custom data entries.
    - `name`: A human-readable identifier for the custom data.
    - `cid`: The CID of the document stored in IPFS.
    - `encrypted`: Boolean flag indicating whether the custom data is encrypted.
    - `encryptionKeyFingerprint`: The fingerprint of the public key used to encrypt the custom data (optional).
    - `signature`: The signature that covers the entire link (including `name`, `cid`, `encrypted`, and `encryptionKeyFingerprint`).

---

### 2. **Profile Flow**

#### **2.1. Profile Creation**

1. **User Account Creation**: The user creates an account via the Circles wallet.
2. **Profile Generation**: A basic profile is generated, containing fields like `previewImageUrl`, `name`, `description`, and an initial `signingKeys` field with the user’s public key.
3. **Storing in IPFS**: The profile is stored in IPFS, and the CID is linked to the user’s Circles account in the NameRegistry contract.

#### **2.2. Adding and Updating Custom Data Links**

Custom data can be added by users or applications, signed with their respective keys. Each data entry is stored as a separate document in IPFS, and the profile only contains signed links to these documents. If a link with the same name already exists, it is replaced.

1. **Custom Data Creation and Signing**:
    - Applications and users create custom data, store it in IPFS, and generate a CID.
    - The **entire custom data link** (including `name`, `cid`, `encrypted`, and `encryptionKeyFingerprint`) is signed with the user's or application’s private key, ensuring that all link properties are covered by the signature.
    - The profile must store a history of public keys used for signing in the `signingKeys` field. Signatures are verified using these public keys.

   **Example Signed Link**:
   ```json
   {
     "name": "preferences",
     "cid": "QmXyz12345...",
     "encrypted": false,
     "encryptionKeyFingerprint": null,
     "signature": "<signature>"
   }
   ```

2. **Updating the Profile**:
    - The signed custom data link is added to the profile. If a link with the same `name` already exists, it is replaced by the new link.
    - The public key used to sign the link must be stored in the `signingKeys` section of the profile.

---

### 3. **Signing Key Management and Verification**

#### **Signing Key History**

The `signingKeys` field in the profile maintains a history of public keys used for signature verification. Each key is stored along with its:
- `validFrom`: The timestamp when the key became active.
- `validTo`: The timestamp when the key expired, if applicable.
- `revokedAt`: The timestamp when the key was revoked, if applicable.

When adding or updating custom data, the signature of the entire link is verified using the appropriate public key from this history.

#### **Signature Verification**

The SDK must verify signatures as follows:

1. **Retrieve Public Key**: Retrieve the public key from the `signingKeys` section based on the `keyFingerprint` of the signature.
2. **Check Validity**: Ensure the key was valid (not expired or revoked) at the time the data was signed.
3. **Verify Signature**: Verify the signature using the matching public key and ensure that it covers all fields in the link (`name`, `cid`, `encrypted`, and `encryptionKeyFingerprint`).

If the signature cannot be verified, the custom data link is rejected.

---

### 4. **Encrypted Data Handling**

#### **Encryption Metadata**

When data is encrypted by an application or user, the following fields are included in the `customDataLinks` entry:

- `encrypted`: Boolean flag indicating whether the custom data is encrypted.
- `encryptionKeyFingerprint`: Fingerprint of the user’s public key used to encrypt the custom data.

#### **Decryption on Retrieval**

When retrieving custom data from IPFS:

1. **Checking Encryption**: The SDK checks the `encrypted` flag in the `customDataLinks` entry.
2. **Verifying the Encryption Key**: The SDK verifies whether the decryption key’s fingerprint matches the user’s current private key.
3. **Decryption**: If the decryption is successful, the data is returned. If decryption fails, the custom data entry is ignored.

---

### 5. **API Endpoints**

#### **Circles NameRegistry Contract**

- **Function**: `getProfile(address user) -> CID`
    - Retrieves the latest CID for the given user’s profile from the NameRegistry contract.

- **Function**: `updateProfile(address user, CID newProfileCID)`
    - Updates the user’s profile CID in the NameRegistry contract.

#### **Application Signing Server API**

- **POST** `/signData`
    - **Description**: Signs the custom data link and validates the content.
    - **Request Body**:
      ```json
      {
        "cid": "<CID of custom data document>",
        "operatorOrganizationAddress": "<appCirclesAddress>"
      }
      ```
    - **Response**:
      ```json
      {
        "signature": "<signature>",
        "cid": "<CID of custom data document>",
        "operatorOrganizationAddress": "<appCirclesAddress>"
      }
      ```

---

### 6. **SDK Overview**

The SDK must support the following functionalities for interacting with profiles and custom data, including managing public keys, verifying signatures, and handling encrypted data:

#### **`createProfile(name: string, description: string, imageUrl: string): CID`**
- Creates a new user profile, stores it in IPFS, and returns the CID.

#### **`addSigningKey(userAddress: string, publicKey: string, validFrom: number, validTo?: number, revokedAt?: number): void`**
- Adds a new signing key to the user’s `signingKeys` field.

#### **`addCustomDataLink(userAddress: string, name: string, cid: string, signature: string, operatorOrganizationAddress: string, encrypted: boolean, encryptionKeyFingerprint?: string): void`**
- Adds or updates a signed custom data link in the user’s profile under the `customDataLinks` section, replacing any existing link with the same `name`.

#### **`getProfile(userAddress: string): Profile`**
- Fetches the latest profile from IPFS using the CID stored in the NameRegistry contract.

#### **`verifySignature(link: object, signature: string, keyFingerprint: string): boolean`**
- Verifies the signature on

the entire link using the public key corresponding to the provided key fingerprint from the `signingKeys` field. The verification ensures that all link fields (`name`, `cid`, `encrypted`, `encryptionKeyFingerprint`) are covered by the signature.

#### **`decryptData(encryptedData: string, userPrivateKey: string): object`**
- Attempts to decrypt the encrypted data using the user’s private key. If decryption is not possible, the data is ignored.

---

### 7. **Example: Complete User Profile with Signing Key History and Signed Links**

```json
{
  "previewImageUrl": "ipfs://<cid>",
  "name": "Alice",
  "description": "Web3 enthusiast",
  "signingKeys": {
    "0xKeyFingerprint1": {
      "publicKey": "0xPublicKey1...",
      "validFrom": 1672531200,
      "validTo": null,
      "revokedAt": null
    },
    "0xKeyFingerprint2": {
      "publicKey": "0xPublicKey2...",
      "validFrom": 1609459200,
      "validTo": 1640995200,
      "revokedAt": null
    }
  },
  "customDataLinks": {
    "0x1234ApplicationCirclesAddress": [
      {
        "name": "preferences",
        "cid": "QmXyz12345...",
        "encrypted": false,
        "encryptionKeyFingerprint": null,
        "signature": "0xabcdef..."
      }
    ],
    "0x5678ApplicationCirclesAddress": [
      {
        "name": "settings",
        "cid": "QmAbc54321...",
        "encrypted": true,
        "encryptionKeyFingerprint": "0x123456...",
        "signature": "0x987654..."
      }
    ],
    "0xUserAddress": [
      {
        "name": "personalNotes",
        "cid": "QmUser12345...",
        "encrypted": true,
        "encryptionKeyFingerprint": "0xabcdef...",
        "signature": "0xuserdef..."
      }
    ]
  }
}
```

- The profile contains a history of signing keys (`signingKeys`).
- Each custom data link is signed as a whole, ensuring the integrity of all properties (such as `name`, `cid`, and encryption metadata).
- Signatures are verified using the signing keys stored in the profile.
