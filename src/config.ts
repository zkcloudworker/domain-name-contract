import { PrivateKey, PublicKey } from "o1js";

interface ContractConfig {
  contractPrivateKey: PrivateKey;
  contractAddress: string;
  ownerPrivateKey: PrivateKey;
  firstBlockPrivateKey?: PrivateKey;
  firstBlockPublicKey?: PublicKey;
}

export const nameContract: ContractConfig = {
  contractPrivateKey: PrivateKey.fromBase58(
    "EKFYqSKXWHWVX7MyTE5o2yXfpfJ2iPmY26CoKcbKd4cBEYngqc6u"
  ),
  contractAddress: "B62qm6vHKPPLAMSitQcNMEUTbJAq1VeLzdnVHBvUKhADwezsD7hNAME",
  ownerPrivateKey: PrivateKey.fromBase58(
    "EKFRg9MugtXvFPe4N6Au28kQyYx9txt4CVPgBPRYdv4wvbKBJpEy"
  ),
  firstBlockPrivateKey: PrivateKey.fromBase58(
    "EKDjCdQMYuc6F3XRRSmCaWYH1WiMUXHHQkvzgKBp9NnhA9PHGXwf"
  ),
  firstBlockPublicKey: PublicKey.fromBase58(
    "B62qpRmnH6SU4hZ9Z9JLm877SUaHSahFhu1nTwiPzJgmsZ2AsMnNAME"
  ),
};

export const validatorsPrivateKeys: PrivateKey[] = [
  PrivateKey.fromBase58("EKEdPmiFqHFXWdW2PSdEm3R2DbNrYX2JCZUW7ohkM5yfoGhMDX9b"),
  //PrivateKey.fromBase58("EKDnzzMz49eFxsqFt3FFmy6b933sJ9tUWuMEcfew241pzwPxk3aW"),
];

export const JWT =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjY0NTkwMzQ5NDYiLCJpYXQiOjE3MDEzNTY5NzEsImV4cCI6MTczMjg5Mjk3MX0.r94tKntDvLpPJT2zzEe7HMUcOAQYQu3zWNuyFFiChD0";

export const deployer = PrivateKey.fromBase58(
  "EKDzixo6SWARNNSbS8PrGd8PPPSPfneJWcC2dFgmeWmbSk6uj12z"
);
