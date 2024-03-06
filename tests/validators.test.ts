import { describe, expect, it } from "@jest/globals";
import {
  Field,
  PrivateKey,
  Encoding,
  Poseidon,
  PublicKey,
  Signature,
  verify,
  setNumberOfWorkers,
} from "o1js";
import { validatorsPrivateKeys } from "../src/config";
import {
  ValidatorsDecision,
  ValidatorsDecisionState,
  ValidatorsVoting,
  ValidatorsVotingProof,
  ValidatorWitness,
} from "../src/rollup/validators";
import { MerkleTree } from "../src/lib/merkle-tree";

describe("Validators", () => {
  const tree = new MerkleTree(3);
  const validators = validatorsPrivateKeys.map((key) => key.toPublicKey());
  tree.fill(
    validators.map((publicKey) => Poseidon.hashPacked(PublicKey, publicKey))
  );
  let totalHash = Field(0);
  for (let i = 0; i < validators.length; i++) {
    const hash = Poseidon.hashPacked(PublicKey, validators[i]);
    tree.setLeaf(BigInt(i), hash);
    totalHash = totalHash.add(hash);
  }
  const root = tree.getRoot();
  const decision = new ValidatorsDecision({
    contract: PrivateKey.random().toPublicKey(),
    root,
    decision: Field(1),
    address: PrivateKey.random().toPublicKey(),
    data1: Field(1),
    data2: Field(1),
  });
  it(`should calculate proof`, async () => {
    console.log("Compiling contracts...");
    setNumberOfWorkers(8);
    console.time("ValidatorsVoting compiled");
    const verificationKey = (await ValidatorsVoting.compile()).verificationKey;
    console.timeEnd("ValidatorsVoting compiled");
    console.time(`prepared proof`);
    const proofs: ValidatorsVotingProof[] = [];
    for (let i = 0; i < validators.length; i++) {
      console.log("proof", i);
      const signature = Signature.create(
        validatorsPrivateKeys[i],
        decision.toFields()
      );
      const witness = new ValidatorWitness(tree.getWitness(BigInt(i)));
      const state = ValidatorsDecisionState.vote(
        decision,
        validators[i],
        witness,
        signature
      );
      const proof = await ValidatorsVoting.vote(
        state,
        decision,
        validators[i],
        witness,
        signature
      );
      proofs.push(proof);
    }
    let proof: ValidatorsVotingProof = proofs[0];
    for (let i = 1; i < proofs.length; i++) {
      console.log("merge", i);
      const state = ValidatorsDecisionState.merge(
        proof.publicInput,
        proofs[i].publicInput
      );
      const mergedProof = await ValidatorsVoting.merge(state, proof, proofs[i]);
      proof = mergedProof;
    }
    console.timeEnd(`prepared proof`);
    const ok = await verify(proof.toJSON(), verificationKey);
    console.log("Proof verification result:", ok);
    expect(ok).toBe(true);
    if (!ok) return;
    expect(Number(proof.publicInput.count.toBigInt())).toBe(validators.length);
    expect(proof.publicInput.hash.toJSON()).toBe(totalHash.toJSON());
  });
});
