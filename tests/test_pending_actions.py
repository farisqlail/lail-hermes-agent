from hermes.pending_actions import PendingStore


def test_add_returns_action_with_id_and_lists_it():
    st = PendingStore()
    pa = st.add("gmail__send_email", {"to": "x@y.z"}, "web")
    assert pa.id
    assert pa.tool == "gmail__send_email"
    assert pa.args == {"to": "x@y.z"}
    assert pa.conv_id == "web"
    assert [a.id for a in st.list()] == [pa.id]


def test_summary_is_server_and_tool():
    st = PendingStore()
    assert st.add("gmail__send_email", {}, "web").summary() == "gmail: send_email"
    assert st.add("noserver", {}, "web").summary() == "noserver"


def test_list_is_oldest_first():
    st = PendingStore()
    a = st.add("s__one", {}, "web")
    b = st.add("s__two", {}, "web")
    assert [x.id for x in st.list()] == [a.id, b.id]


def test_pop_removes_and_returns():
    st = PendingStore()
    pa = st.add("s__t", {}, "web")
    assert st.pop(pa.id) is pa
    assert st.pop(pa.id) is None
    assert st.list() == []


def test_pop_oldest_is_fifo():
    st = PendingStore()
    a = st.add("s__one", {}, "web")
    st.add("s__two", {}, "web")
    assert st.pop_oldest() is a
    assert len(st.list()) == 1


def test_pop_oldest_empty_is_none():
    assert PendingStore().pop_oldest() is None


def test_ids_are_unique():
    st = PendingStore()
    ids = {st.add("s__t", {}, "web").id for _ in range(5)}
    assert len(ids) == 5
