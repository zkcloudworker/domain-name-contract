import { PrivateKey } from "o1js";

interface ContractConfig {
  contractPrivateKey: PrivateKey;
  contractAddress: string;
  ownerPrivateKey: PrivateKey;
}

export const nameContract: ContractConfig = {
  contractPrivateKey: PrivateKey.fromBase58(
    "EKEpSiV7GCqidsaXsnhUFEE1qHYLsNvpPqx6fWXfAPDrdPoNrE7f"
  ),
  contractAddress: "B62qmWinDr5Z6mNTLhrmYJaVpT5VkAvzPj2yNMpgvZW2tG7ecVcNAME",
  ownerPrivateKey: PrivateKey.fromBase58(
    "EKFRg9MugtXvFPe4N6Au28kQyYx9txt4CVPgBPRYdv4wvbKBJpEy"
  ),
};

export const validatorsPrivateKeys: PrivateKey[] = [
  PrivateKey.fromBase58("EKEdPmiFqHFXWdW2PSdEm3R2DbNrYX2JCZUW7ohkM5yfoGhMDX9b"),
  PrivateKey.fromBase58("EKDnzzMz49eFxsqFt3FFmy6b933sJ9tUWuMEcfew241pzwPxk3aW"),
];

export const JWT =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjY0NTkwMzQ5NDYiLCJpYXQiOjE3MDEzNTY5NzEsImV4cCI6MTczMjg5Mjk3MX0.r94tKntDvLpPJT2zzEe7HMUcOAQYQu3zWNuyFFiChD0";

export const deployer = PrivateKey.fromBase58(
  "EKDzixo6SWARNNSbS8PrGd8PPPSPfneJWcC2dFgmeWmbSk6uj12z"
);
