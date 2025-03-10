export interface IPFSDataProfile {
  name: string;
  description?: string;
  imageUrl?: string;
  previewImageUrl?: string;
}

export interface Profile {
  address: string;
  CID: string;
  lastUpdatedAt: number;
  name: string;
  description?: string;
  location?: string; // Optional location (max 100 characters)
  registeredName: string | null;
}

export type CompleteProfile = Profile & IPFSDataProfile;
