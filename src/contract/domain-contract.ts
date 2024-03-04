import {
  Field,
  state,
  State,
  method,
  SmartContract,
  DeployArgs,
  Reducer,
  Permissions,
  Struct,
  PublicKey,
  Bool,
  Signature,
} from "o1js";

import { Storage } from "./storage";
import { MapUpdateProof, MapTransition } from "./update";
import { DomainName } from "./update";

export const BATCH_SIZE = 3; //TODO: change to 256 in production

export class DomainNameAction extends Struct({
  domain: DomainName,
  hash: Field,
}) {}

export class ReducerState extends Struct({
  count: Field,
  hash: Field,
}) {
  static assertEquals(a: ReducerState, b: ReducerState) {
    a.count.assertEquals(b.count);
    a.hash.assertEquals(b.hash);
  }
}

export class MapTransitionEvent extends Struct({
  transition: MapTransition,
  storage: Storage,
}) {}

export class DomainNameContract extends SmartContract {
  @state(Field) domain = State<Field>();
  @state(Field) root = State<Field>();
  @state(Field) updates = State<Field>();
  @state(Field) count = State<Field>();
  @state(Field) actionState = State<Field>();
  @state(PublicKey) owner = State<PublicKey>();
  @state(Bool) isSynced = State<Bool>();

  deploy(args: DeployArgs) {
    super.deploy(args);
    this.account.permissions.set({
      ...Permissions.default(),
      editState: Permissions.proof(),
    });
  }

  // TODO: add init, snapshot, 5 last states in token accounts

  reducer = Reducer({
    actionType: DomainNameAction,
  });

  events = {
    add: DomainName,
    update: DomainName,
    reduce: ReducerState,
    commitNewNames: MapTransitionEvent,
    commitUpdatedNames: MapTransitionEvent,
  };

  @method add(domain: DomainName, signature: Signature) {
    const hash = domain.hash();
    const action = new DomainNameAction({ domain, hash });

    signature.verify(domain.address, domain.toFields()).assertEquals(true);
    this.reducer.dispatch(action);
    this.emitEvent("add", domain);
  }

  @method update(domain: DomainName, signature: Signature) {
    const hash = domain.hash();
    const action = new DomainNameAction({ domain, hash });

    signature.verify(domain.address, domain.toFields()).assertEquals(true);
    this.reducer.dispatch(action);
    this.emitEvent("update", domain);
  }

  @method reduce(
    startActionState: Field,
    endActionState: Field,
    reducerState: ReducerState,
    proof: MapUpdateProof,
    signature: Signature
  ) {
    const owner = this.owner.getAndRequireEquals();
    signature.verify(owner, proof.publicInput.toFields()).assertEquals(true);
    proof.verify();
    proof.publicInput.oldRoot.assertEquals(this.root.getAndRequireEquals());
    proof.publicInput.hash.assertEquals(reducerState.hash);
    proof.publicInput.count.assertEquals(reducerState.count.toFields()[0]);

    const actionState = this.actionState.getAndRequireEquals();
    actionState.assertEquals(startActionState);
    const count = this.count.getAndRequireEquals();

    const pendingActions = this.reducer.getActions({
      fromActionState: actionState,
      endActionState,
    });

    let elementsState: ReducerState = new ReducerState({
      count: Field(0),
      hash: Field(0),
    });

    const { state: newReducerState, actionState: newActionState } =
      this.reducer.reduce(
        pendingActions,
        ReducerState,
        (state: ReducerState, action: DomainNameAction) => {
          return new ReducerState({
            count: state.count.add(Field(1)),
            hash: state.hash.add(action.hash),
          });
        },
        {
          state: elementsState,
          actionState: actionState,
        },
        {
          maxTransactionsWithActions: BATCH_SIZE,
          skipActionStatePrecondition: true,
        }
      );
    ReducerState.assertEquals(newReducerState, reducerState);
    const accountActionState = this.account.actionState.getAndRequireEquals();
    const isSynced = newActionState.equals(accountActionState);
    this.isSynced.set(isSynced);
    this.count.set(count.add(newReducerState.count));
    this.actionState.set(newActionState);
    this.root.set(proof.publicInput.newRoot);
    this.emitEvent("reduce", reducerState);
  }

  @method commitNewNames(
    proof: MapUpdateProof,
    signature: Signature,
    storage: Storage
  ) {
    const owner = this.owner.getAndRequireEquals();
    signature.verify(owner, proof.publicInput.toFields()).assertEquals(true);
    proof.verify();
    proof.publicInput.oldRoot.assertEquals(this.root.getAndRequireEquals());

    const count = this.count.getAndRequireEquals();
    this.count.set(count.add(proof.publicInput.count));
    this.root.set(proof.publicInput.newRoot);
    const transitionEvent = new MapTransitionEvent({
      transition: proof.publicInput,
      storage: storage,
    });
    this.emitEvent("commitNewNames", transitionEvent);
  }

  @method commitUpdatedNames(
    proof: MapUpdateProof,
    signature: Signature,
    storage: Storage
  ) {
    const owner = this.owner.getAndRequireEquals();
    signature.verify(owner, proof.publicInput.toFields()).assertEquals(true);
    proof.verify();
    proof.publicInput.oldRoot.assertEquals(this.updates.getAndRequireEquals());

    this.updates.set(proof.publicInput.newRoot);
    const transitionEvent = new MapTransitionEvent({
      transition: proof.publicInput,
      storage: storage,
    });
    this.emitEvent("commitUpdatedNames", transitionEvent);
  }

  @method setOwner(newOwner: PublicKey, signature: Signature) {
    const owner = this.owner.getAndRequireEquals();
    signature.verify(owner, newOwner.toFields()).assertEquals(true);
    this.owner.set(newOwner);
  }

  // TODO: remove after debugging
  @method setRoot(root: Field, count: Field, signature: Signature) {
    const owner = this.owner.getAndRequireEquals();
    signature.verify(owner, [root, count]).assertEquals(true);
    this.root.set(root);
    this.count.set(count);
  }
}
