from hermes.pending_actions import PendingStore


def test_add_returns_action_with_id_and_lists_it():
    st = PendingStore()
    pa = st.add("gmail__send_email", {"to": "x@y.z"}, "web")
    assert pa.id
    assert pa.tool == "gmail__send_email"
    assert pa.args == {"to": "x@y.z"}
    assert pa.conv_id == "web"
    assert [a.id for a in st.list()] == [pa.id]


def test_add_accepts_and_defaults_a_risk_note():
    st = PendingStore()
    plain = st.add("s__t", {}, "web")
    assert plain.risk_note == ""

    explained = st.add("fs__delete_file", {"path": "x"}, "web",
                       risk_note="Ini akan menghapus file secara permanen.")
    assert explained.risk_note == "Ini akan menghapus file secara permanen."


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


def test_list_scoped_to_one_conversation():
    st = PendingStore()
    mine = st.add("s__one", {}, "sess-a")
    st.add("s__two", {}, "sess-b")
    assert [x.id for x in st.list("sess-a")] == [mine.id]
    assert st.list("sess-none") == []
    assert len(st.list()) == 2      # unscoped still sees everything


def test_ids_are_unique():
    st = PendingStore()
    ids = {st.add("s__t", {}, "web").id for _ in range(5)}
    assert len(ids) == 5


def test_add_carries_an_optional_chat_id():
    st = PendingStore()
    pa = st.add("gmail__send_email", {}, "tg-555", chat_id=555)
    assert pa.chat_id == 555


def test_chat_id_defaults_to_none():
    st = PendingStore()
    pa = st.add("gmail__send_email", {}, "web")
    assert pa.chat_id is None

