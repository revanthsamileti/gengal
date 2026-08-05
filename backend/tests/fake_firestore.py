"""A Firestore stand-in just large enough for the coin-purchase paths.

Deliberately tiny: it models documents as plain dicts and runs "transactions"
inline. That is enough to assert what the tests care about — which documents a
request reads, what it writes, and whether a second attempt writes again — and
it keeps the money tests runnable with no emulator and no network.
"""
import copy


SERVER_TIMESTAMP = "<server-timestamp>"


class FakeSnapshot:
    def __init__(self, data):
        self._data = data
        self.exists = data is not None

    def to_dict(self):
        return copy.deepcopy(self._data) if self._data is not None else None


class FakeDocRef:
    def __init__(self, store, path):
        self._store = store
        self._path = path

    def get(self, transaction=None):
        return FakeSnapshot(self._store.get(self._path))

    def set(self, data, merge=False):
        if merge and self._path in self._store:
            self._store[self._path].update(copy.deepcopy(data))
        else:
            self._store[self._path] = copy.deepcopy(data)

    def update(self, data):
        if self._path not in self._store:
            raise KeyError("update on missing document: %s" % self._path)
        self._store[self._path].update(copy.deepcopy(data))

    def delete(self):
        self._store.pop(self._path, None)


class FakeCollection:
    def __init__(self, store, name):
        self._store = store
        self._name = name

    def document(self, doc_id):
        return FakeDocRef(self._store, "%s/%s" % (self._name, doc_id))


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
    def __init__(self, store):
        self._store = store

    def collection(self, name):
        return FakeCollection(self._store, name)

    def transaction(self):
        return FakeTransaction(self._store)


class FakeFirestoreModule:
    """Stands in for `firebase_admin.firestore` inside app.py."""

    SERVER_TIMESTAMP = SERVER_TIMESTAMP

    def __init__(self, store):
        self._store = store

    def client(self):
        return FakeClient(self._store)

    @staticmethod
    def transactional(fn):
        # The real decorator supplies retry/commit around the callable; here the
        # writes already land immediately, so passing it through is enough.
        return fn
