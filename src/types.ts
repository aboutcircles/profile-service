export interface IPFSDataProfile {
  name: string;
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
  name: string;
  description?: string;
  registeredName: string | null;
  location?: string;
  geoLocation?: [number, number]; // [longitude, latitude]
}
export type CompleteProfile = Profile & IPFSDataProfile;
