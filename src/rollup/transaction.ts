import { Signature } from "o1js";
import { DomainName } from "../contract/update";

export type DomainTransactionType =
  | "add"
  | "extend"
  | "change"
  | "removeExpired";

export class DomainTransaction {
  constructor(
    public readonly type: DomainTransactionType,
    public readonly domain: DomainName,
    public readonly signature?: Signature,
    public readonly updatedDomain?: DomainName
  ) {}

  public validate(): { valid: boolean; reason: string } {
    if (this.type === "change") {
      if (this.updatedDomain === undefined) {
        return { valid: false, reason: "updatedDomain should be undefined" };
      }
      if (this.signature === undefined) {
        return { valid: false, reason: "signature should be defined" };
      }
    }
    return { valid: true, reason: "" };
  }
}
