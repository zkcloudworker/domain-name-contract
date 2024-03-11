import { Struct, Field } from "o1js";
import axios from "axios";

/**
 * Storage is the hash of the IPFS or Arweave storage where the metadata is written
 * format of the IPFS hash string: i:...
 * format of the Arweave hash string: a:...
 * @property hashString The hash string of the storage
 */
export class Storage extends Struct({
  hashString: [Field, Field],
}) {
  constructor(value: { hashString: [Field, Field] }) {
    super(value);
  }
  toFields(): Field[] {
    return this.hashString;
  }

  static fromFields(fields: Field[]): Storage {
    return new Storage({ hashString: [fields[0], fields[1]] });
  }

  static empty(): Storage {
    return new Storage({ hashString: [Field(0), Field(0)] });
  }

  static assertEquals(a: Storage, b: Storage) {
    a.hashString[0].assertEquals(b.hashString[0]);
    a.hashString[1].assertEquals(b.hashString[1]);
  }
}

export async function saveToIPFS(
  data: any,
  PinataJWT: string | undefined
): Promise<string | undefined> {
  try {
    const str = JSON.stringify(data, null, 2);
    const auth = "Bearer " + PinataJWT ?? "";

    const config = {
      headers: {
        "Content-Type": "application/json",
        Authorization: auth,
      },
    };

    if (auth === "Bearer ")
      //for running tests
      return `QmTosaezLecDB7bAoUoXcrJzeBavHNZyPbPff1QHWw8xus`;

    const res = await axios.post(
      "https://api.pinata.cloud/pinning/pinJSONToIPFS",
      str,
      config
    );

    console.log("saveToIPFS result:", res.data);
    return res.data.IpfsHash;
  } catch (error: any) {
    console.error("saveToIPFS:", error);
    return undefined;
  }
}

export async function loadFromIPFS(hash: string): Promise<any | undefined> {
  try {
    const url =
      "https://salmon-effective-amphibian-898.mypinata.cloud/ipfs/" +
      hash +
      "?pinataGatewayToken=gFuDmY7m1Pa5XzZ3bL1TjPPvO4Ojz6tL-VGIdweN1fUa5oSFZXce3y9mL8y1nSSU";
    //"https://gateway.pinata.cloud/ipfs/" + hash;
    const data = (await axios.get(url)).data;
    return data;
  } catch (error: any) {
    console.error("loadFromIPFS:", error);
    return undefined;
  }
}
