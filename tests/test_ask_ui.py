import asyncio
from hermes import ask_ui
from hermes.ask import Ask, AskRegistry


def _ask(options, multi=False, selected=None, question="Riverpod atau Bloc?"):
    # future=None: every test below is pure rendering or parsing and never
    # awaits, so building a real one would only leak an event loop per call.
    a = Ask("a1b2c3d4", 5, "t1", question, options, multi, None)
    a.selected = set(selected or ())
    return a


def test_single_select_rows_are_one_button_per_option():
    a = _ask([{"label": "Riverpod"}, {"label": "Bloc"}])
    rows = ask_ui.keyboard_rows(a)
    assert [r[0][0] for r in rows] == ["Riverpod", "Bloc"]
    assert [r[0][1] for r in rows] == ["ask:a1b2c3d4:0", "ask:a1b2c3d4:1"]


def test_single_select_has_no_send_button():
    """One tap is the whole interaction; a Send button would double the work."""
    a = _ask([{"label": "Riverpod"}])
    assert all(not r[0][1].endswith(":ok") for r in ask_ui.keyboard_rows(a))


def test_multi_select_marks_state_and_appends_a_send_button():
    a = _ask([{"label": "Riverpod"}, {"label": "Freezed"}],
             multi=True, selected=[1])
    rows = ask_ui.keyboard_rows(a)
    assert rows[0][0][0] == "☐ Riverpod"
    assert rows[1][0][0] == "☑ Freezed"
    assert rows[-1][0][1] == "ask:a1b2c3d4:ok"


def test_long_labels_are_clipped_for_the_button_face():
    a = _ask([{"label": "x" * 200}])
    label = ask_ui.keyboard_rows(a)[0][0][0]
    assert len(label) <= ask_ui.LABEL_MAX
    assert label.endswith("…")


def test_callback_data_fits_telegram_64_byte_cap():
    """Labels never travel in callback_data — indices do — so even 40 options
    with essay-length labels stay inside the cap."""
    a = _ask([{"label": "y" * 300} for _ in range(40)], multi=True)
    for row in ask_ui.keyboard_rows(a):
        for _, data in row:
            assert len(data.encode()) <= 64


def test_parse_callback_reads_an_option_tap():
    assert ask_ui.parse_callback("ask:a1b2c3d4:2") == ("a1b2c3d4", "opt", 2)


def test_parse_callback_reads_the_send_button():
    assert ask_ui.parse_callback("ask:a1b2c3d4:ok") == ("a1b2c3d4", "ok", -1)


def test_parse_callback_rejects_junk():
    for bad in ("", "ask", "ask:only-two", "confirm:t1:yes",
                "ask:a1b2c3d4:notanumber", "ask:a1b2c3d4:1:2"):
        assert ask_ui.parse_callback(bad) is None


def test_question_text_numbers_the_options_and_carries_descriptions():
    a = _ask([{"label": "Riverpod", "description": "sudah dipakai di modul lain"},
              {"label": "Bloc"}])
    text = ask_ui.question_text(a)
    assert "Riverpod atau Bloc?" in text
    assert "sudah dipakai di modul lain" in text
    assert "Bloc" in text


def test_question_text_says_when_multiple_answers_are_allowed():
    a = _ask([{"label": "A"}, {"label": "B"}], multi=True)
    assert "beberapa" in ask_ui.question_text(a).lower()


def test_question_text_has_no_markup_characters_that_telegram_would_parse():
    """sender() sends without parse_mode; stray markers would render literally,
    and an unbalanced one in a user-supplied label would look like a bug."""
    a = _ask([{"label": "*bold*"}], question="pakai `x` atau _y_?")
    assert "<" not in ask_ui.question_text(a)


async def test_free_text_handler_routes_only_while_an_ask_is_pending():
    r = AskRegistry()
    sent = []
    async def on_ask(a): sent.append(a)
    r.on_ask = on_ask
    run = r.run_for_token(r.open_run("t1", 5))
    _, on_text = ask_ui.make_handlers(r, sender=None, edit_markup=None)

    assert not await on_text(chat_id=5, text="halo")     # nothing pending
    task = asyncio.create_task(r.ask(run, "Q?", [{"label": "A"}]))
    await asyncio.sleep(0)
    assert await on_text(chat_id=5, text="pakai Bloc")   # consumed
    assert await task == "User replied (free text): pakai Bloc"
    assert not await on_text(chat_id=5, text="halo lagi")  # back to normal


async def test_free_text_handler_ignores_other_chats():
    r = AskRegistry()
    async def on_ask(a): pass
    r.on_ask = on_ask
    run = r.run_for_token(r.open_run("t1", 5))
    _, on_text = ask_ui.make_handlers(r, sender=None, edit_markup=None)
    task = asyncio.create_task(r.ask(run, "Q?", [{"label": "A"}]))
    await asyncio.sleep(0)
    assert not await on_text(chat_id=99, text="not mine")
    r.answer(r.pending_for_chat(5), "x")
    await task
