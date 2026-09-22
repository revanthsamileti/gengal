"""A Firestore stand-in just large enough for the coin-purchase paths.

Deliberately tiny: it models documents as plain dicts and runs "transactions"
inline. That is enough to assert what the tests care about — which documents a
request reads, what it writes, and whether a second attempt writes again — and
it keeps the money tests runnable with no emulator and no network.
"""
import copy
import itertools


SERVER_TIMESTAMP = "<server-timestamp>"

# Sentinel for a field removal. Compared by identity in FakeDocRef.update, the
# same way the real client distinguishes "delete this key" from "store this
# value" — a plain string would be indistinguishable from data.
class _DeleteField:
    def __repr__(self):
        return "<delete-field>"


DELETE_FIELD = _DeleteField()

_auto_ids = itertools.count(1)


class FakeSnapshot:
    def __init__(self, data):
        self._data = data
        self.exists = data is not None

    def to_dict(self):
        return copy.deepcopy(self._data) if self._data is not None else None


class FakeDocRef:
    def __init__(self, store, path, reads=None):
        self._store = store
        self._path = path
        self._reads = reads

    @property
    def id(self):
        """Trailing path segment, matching the real DocumentReference.id."""
        return self._path.rsplit("/", 1)[-1]

    def get(self, transaction=None):
        # Records whether the caller passed `transaction=`. The fake cannot
        # simulate optimistic concurrency, so it cannot *observe* a double
        # spend — but a read issued without the transaction is never entered
        # into Firestore's read set, which is precisely what would let two
        # concurrent callers both see no pending request and both be paid.
        # Recording it lets a test assert the wiring is there, so dropping the
        # kwarg fails the suite instead of passing it silently.
        if self._reads is not None:
            self._reads.append({"path": self._path, "in_transaction": transaction is not None})
        return FakeSnapshot(self._store.get(self._path))

    def set(self, data, merge=False):
        if merge and self._path in self._store:
            self._store[self._path].update(copy.deepcopy(data))
        else:
            self._store[self._path] = copy.deepcopy(data)

    def update(self, data):
        if self._path not in self._store:
            raise KeyError("update on missing document: %s" % self._path)
        target = self._store[self._path]
        for key, value in data.items():
            if isinstance(value, _DeleteField):
                target.pop(key, None)
            else:
                target[key] = copy.deepcopy(value)

    def delete(self):
        self._store.pop(self._path, None)

    def collection(self, name):
        """A subcollection, e.g. chats/{id}/messages."""
        return FakeCollection(self._store, "%s/%s" % (self._path, name), self._reads)


class FakeQueryDoc(FakeSnapshot):
    def __init__(self, doc_id, data):
        super().__init__(data)
        self.id = doc_id


class FakeQuery:
    """Equality filters and a limit, which is all the listing endpoints use."""

    def __init__(self, store, name, filters=(), cap=None):
        self._store = store
        self._name = name
        self._filters = list(filters)
        self._cap = cap

    def where(self, field, op, value):
        if op != "==":
            raise NotImplementedError("fake supports == only")
        return FakeQuery(self._store, self._name, self._filters + [(field, value)], self._cap)

    def limit(self, n):
        return FakeQuery(self._store, self._name, self._filters, n)

    def stream(self):
        prefix = self._name + "/"
        out = []
        for path, data in self._store.items():
            rest = path[len(prefix):] if path.startswith(prefix) else None
            # Direct children only: chats/x/messages/y is not a document of chats.
            if not rest or "/" in rest:
                continue
            if all(data.get(f) == v for f, v in self._filters):
                out.append(FakeQueryDoc(rest, data))
        return out[: self._cap] if self._cap is not None else out


class FakeCollection:
    def __init__(self, store, name, reads=None):
        self._store = store
        self._name = name
        self._reads = reads

    def document(self, doc_id=None):
        # A bare .document() mints a new id, as the real client does — that is
        # how the withdrawal endpoint reserves a reference before writing it.
        if doc_id is None:
            doc_id = "auto_%d" % next(_auto_ids)
        return FakeDocRef(self._store, "%s/%s" % (self._name, doc_id), self._reads)

    def where(self, field, op, value):
        return FakeQuery(self._store, self._name).where(field, op, value)

    def limit(self, n):
        return FakeQuery(self._store, self._name).limit(n)


class FakeTransaction:
    """Applies writes immediately.

    Real transactions retry on contention; these tests exercise ordering and
    idempotence, not contention, so immediate application is the right amount
    of fidelity. `test_replay_does_not_credit_twice` still catches a missing
    status flip, because the second call re-reads what the first wrote.
    """

    def __init__(self, store):
        self._store = store

    def update(self, ref, data):
        ref.update(data)

    def set(self, ref, data, merge=False):
        ref.set(data, merge=merge)


class FakeClient:
    def __init__(self, store, reads=None):
        self._store = store
        self._reads = reads

    def collection(self, name):
        return FakeCollection(self._store, name, self._reads)

    def transaction(self):
        return FakeTransaction(self._store)


class FakeFirestoreModule:
    """Stands in for `firebase_admin.firestore` inside app.py."""

    SERVER_TIMESTAMP = SERVER_TIMESTAMP
    DELETE_FIELD = DELETE_FIELD

    def __init__(self, store):
        self._store = store
        #: Every document read, in order, as {"path", "in_transaction"}.
        self.reads = []

    def client(self):
        return FakeClient(self._store, self.reads)

    @staticmethod
    def transactional(fn):
        # The real decorator supplies retry/commit around the callable; here the
        # writes already land immediately, so passing it through is enough.
        return fn
