export interface IPFSDataProfile {
  name: string | null;
  description?: string;
  imageUrl?: string;
  previewImageUrl?: string;
  location?: string;
  geoLocation?: [number, number]; // [longitude, latitude]
}

export interface Profile {
  address: string;
  CID: string;
  lastUpdatedAt: number;
  name: string | null;
  description?: string;
  registeredName: string | null;
  location?: string;
  geoLocation?: [number, number]; // [longitude, latitude]
  longitude?: number;
  latitude?: number;
}

export type CompleteProfile = Profile & IPFSDataProfile;
