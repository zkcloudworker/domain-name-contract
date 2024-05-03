import { describe, expect, it } from "@jest/globals";
import { DomainName } from "../src/rollup/transaction";
import { deserializeFields } from "../src/lib/fields";
import { stringFromFields } from "../src/lib/hash";
import { loadFromIPFS } from "../src/contract/storage";

const domainSerialized =
  "I.jSFuCAJbyOCugCaZLsx8sjAM0PVVv-9YYUudtIwTSU.q9GauF.U0LY4OOs39fTpXOwAUbXaG5OhX5w1F0krHH1060XjOC..A_RucMswIrv5PMYqhYk1rFtzBt2i7kMd-J_70JBXBJD.A_RucMswIrv5PMYqhYk1rFtzBt2i7kMd-J_70JBXBJD.ppjYhZ2ayVWaklGa0ZWajhWeyl3Y5Vmbrt2aml3N2B.1tGajN3YjlmZ5JHa28mYiZHZtJnYrFnbrJTNmZDNB.ZtxNSaZ";

describe("NFT metadata", () => {
  it(`should get the NFT metadata`, async () => {
    const domain = DomainName.fromFields(deserializeFields(domainSerialized));
    const name = stringFromFields([domain.name]);
    const ipfs = domain.data.storage.toIpfsHash();
    const nft = await loadFromIPFS(ipfs);
    const address = domain.data.address.toBase58();
    const expiry = new Date(
      Number(domain.data.expiry.toBigInt())
    ).toLocaleString();
    console.log({ name, address, expiry, ipfs, nft, metadata: nft.metadata });
  });
});
