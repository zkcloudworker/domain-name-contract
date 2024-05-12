import { PrivateKey, PublicKey } from "o1js";

interface ContractConfig {
  contractPrivateKey: PrivateKey;
  contractAddress: string;
  firstBlockPrivateKey?: PrivateKey;
  firstBlockPublicKey?: PublicKey;
}

export const nameContract: ContractConfig = {
  contractPrivateKey: PrivateKey.fromBase58(
    "EKEVjiMz5ogNynnKmLF1oRs6Wj5bZdW1itZgvpTQYaHrPnu3qFpG"
    //"EKDoUN9nf8mQdpBuWY7Vveuiw3sxW6dCiq3HYKLdJGGgHk6Vb1Nx"
    //"EKE7VYjsrdekFzcZ2BLpeweZewnG6GRjfjU4WT4bw68k8pCy6HBq"
    //"EKDtgZwKqCHCXYCqaeZhfxiL5HXC9zQFAnXzEtcJGcjMtJFSCngZ"
    //"EKDv9j1xgaEeRgaoZUGyxiRvGAjo3eLcPtoasLCKrmopdKXodAAA"
  ),
  contractAddress: "B62qnXXnnwnyUKbEBuQM64LEfNcBRzCkeNSCu3H4mhbe7ittQX2mDNS",
  // "B62qrjWrAaXV65CZgpfhLdFynbFdyj851cWZPCPvF92mF3ohGDbNAME",
  // "B62qrR3kE3S9xsQy2Jq8tp3TceWDeAmiXhU4KCXh19HzAVPj7BiNAME",
  // "B62qmyBYvHL5g7os2HFcGJC1QASTkFC8ydUBZRKGrxDqhV853YoNAME",
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
