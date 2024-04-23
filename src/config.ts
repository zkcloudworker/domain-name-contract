import { PrivateKey, PublicKey } from "o1js";

interface ContractConfig {
  contractPrivateKey: PrivateKey;
  contractAddress: string;
  firstBlockPrivateKey?: PrivateKey;
  firstBlockPublicKey?: PublicKey;
}

export const nameContract: ContractConfig = {
  contractPrivateKey: PrivateKey.fromBase58(
    "EKDtgZwKqCHCXYCqaeZhfxiL5HXC9zQFAnXzEtcJGcjMtJFSCngZ"
    //"EKDv9j1xgaEeRgaoZUGyxiRvGAjo3eLcPtoasLCKrmopdKXodAAA"
  ),
  contractAddress: "B62qmyBYvHL5g7os2HFcGJC1QASTkFC8ydUBZRKGrxDqhV853YoNAME",
  //"B62qqNQ9kMtc4L9p19eK8SfLRy8EamtMRWAVqcCaJSM1Q5AD3DjNAME",

  firstBlockPrivateKey: PrivateKey.fromBase58(
    "EKDjCdQMYuc6F3XRRSmCaWYH1WiMUXHHQkvzgKBp9NnhA9PHGXwf"
  ),
  firstBlockPublicKey: PublicKey.fromBase58(
    "B62qpRmnH6SU4hZ9Z9JLm877SUaHSahFhu1nTwiPzJgmsZ2AsMnNAME"
  ),
};

export const blockProducer = {
  publicKey: PublicKey.fromBase58(
    "B62qrjVdai5dwVie36KGy5cYrLN9YfB2EJ5mRXSEVcnzrA3Q3AqNAME"
  ),
  privateKey: PrivateKey.fromBase58(
    "EKDqL5JFFqfL9UGUuUpJiDGnYWxdB1tmcYUbWH8iAxWSMkYs25bz"
  ),
};

export const validatorsPrivateKeys: PrivateKey[] = [
  PrivateKey.fromBase58("EKEdPmiFqHFXWdW2PSdEm3R2DbNrYX2JCZUW7ohkM5yfoGhMDX9b"),
  //PrivateKey.fromBase58("EKDnzzMz49eFxsqFt3FFmy6b933sJ9tUWuMEcfew241pzwPxk3aW"),
];

export const JWT =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjY0NTkwMzQ5NDYiLCJpYXQiOjE3MDEzNTY5NzEsImV4cCI6MTczMjg5Mjk3MX0.r94tKntDvLpPJT2zzEe7HMUcOAQYQu3zWNuyFFiChD0";
