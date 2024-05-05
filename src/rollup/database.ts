import { Field, MerkleMap } from "o1js";
import { DomainName } from "./transaction";
import { stringFromFields } from "../lib/hash";
import { serializeFields, deserializeFields } from "../lib/fields";

export class DomainDatabase {
  data: { [name: string]: string } = {};

  constructor(data: { [name: string]: string } = {}) {
    this.data = data;
  }

  insert(domain: DomainName) {
    const name = stringFromFields([domain.name]);
    const value = serializeFields(DomainName.toFields(domain));
    this.data[name] = value;
  }

  remove(name: Field) {
    delete this.data[stringFromFields([name])];
  }

  get(name: Field): DomainName | undefined {
    const value = this.data[stringFromFields([name])];
    if (value === undefined) return undefined;
    return new DomainName(DomainName.fromFields(deserializeFields(value)));
  }

  put(name: Field, domain: DomainName | undefined) {
    if (domain === undefined) {
      this.remove(name);
    } else {
      this.insert(domain);
    }
  }

  getRoot(): Field {
    const map = new MerkleMap();
    Object.keys(this.data).map((key) => {
      const domain: DomainName = new DomainName(
        DomainName.fromFields(deserializeFields(this.data[key]))
      );
      const name = stringFromFields([domain.name]);
      if (name !== key) throw new Error("DomainDatabase: invalid key");
      map.set(domain.key(), domain.value());
    });
    return map.getRoot();
  }
}
