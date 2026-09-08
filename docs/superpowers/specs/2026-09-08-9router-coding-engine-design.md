# Engine coding lewat API 9Router, bukan CLI

Tanggal: 2026-09-08
Status: disetujui, siap direncanakan

## Masalah

Step `code` adalah satu-satunya bagian Hermes yang masih menumpang proses lain.
`hermes/orchestrator.py:855` memanggil `run_engine`, dan `hermes/engine_runner.py`
men-spawn `claude -p` atau `agy -p` sebagai subprocess.

Sisa otak Hermes sudah tidak begitu. Planner, chat, ekstraksi fakta, kompresi,
title, review PR, dan office semuanya sudah bicara ke gateway
OpenAI-compatible — 9Router — lewat `AsyncOpenAI`. Nama fieldnya saja yang masih
warisan lama (`nvidia_base_url`, `NVIDIA_API_KEY` di `hermes/config.py:114,441`);
`hermes/imagegen.py:1` sudah menyebut gateway itu dengan nama sebenarnya.

Jadi ketergantungan pada CLI membawa biaya tanpa membawa kemampuan yang tidak
bisa didapat lewat API yang sudah dipakai:

- **Resolusi biner Windows.** `_resolve` harus mencoba `.exe`, `.cmd`, `.bat`,
  `.ps1` karena `create_subprocess_exec` tidak menerapkan PATHEXT, lalu
  membungkus shim skrip ke interpreternya. `_extra_tool_dirs` ada murni karena
  jendela cmd men-cache PATH saat diluncurkan, sehingga CLI yang baru diinstal
  tak terlihat sampai jendelanya dibuka ulang.
- **Dua bentuk stream.** claude dan agy memancarkan JSONL yang tidak berbagi
  apa pun selain kata "result", jadi ada dua distiller (`distill_claude_line`,
  `distill_agy_line`) dan dua parser envelope.
- **Permukaan tanpa scope.** Kedua CLI dijalankan dengan
  `--dangerously-skip-permissions` dan tidak dibatasi ke direktori proyek.
- **Dua instalasi eksternal** yang harus ada, ter-update, dan terautentikasi di
  mesin operator — terpisah dari kunci 9Router yang sudah ada.

## Keputusan

Ganti CLI dengan loop agentik in-process yang bicara ke 9Router lewat kunci API
yang **sudah ada**. Tidak ada secret baru, tidak ada endpoint baru.

Perpindahan dilakukan **tiga fase**: tambah engine `api` (aditif), jadikan
default, lalu hapus CLI. Fase 3 adalah komitmen, bukan opsi — tapi gerbangnya
adalah bukti dari fase 2, bukan tanggal.

Tiga keputusan yang mengunci bentuknya:

1. **Tool file/exec ditulis native dan ter-scope ke direktori proyek**, bukan
   memakai ulang MCP `pc` (desktop-commander). Server itu tanpa scope folder
   (`hermes/config.py:65`), dan step `code` tidak punya alasan bisa menyentuh
   `C:\` di luar proyek.
2. **`run_cmd` auto-run di dalam direktori proyek.** Ini bukan penurunan
   keamanan: hari ini CLI berjalan dengan `--dangerously-skip-permissions` dan
   tanpa scope sama sekali. Task berisiko tetap digerbang konfirmasi Telegram
   seperti sebelumnya.
3. **Engine baru memancarkan stream-json berbentuk claude.** Bukan format
   sendiri. Ini yang membuat seluruh jalur konsumen — timeline, hitung token,
   deteksi selesai, retry, budget — tidak disentuh sama sekali.

## Kenapa pendekatan ini

Alternatif yang ditolak:

- **Format event native.** `engine_api` memancarkan `TraceEvent` langsung dan
  punya tipe outcome sendiri. Lebih bersih di dalam, tapi menyentuh
  `orchestrator._trace_sink`, `engine_stream`, `engine_result`, dan jalur
  token/biaya — diff jauh lebih lebar untuk hasil yang identik di layar.
- **CLI sendiri.** Menulis CLI mini yang bicara 9Router lalu tetap
  men-spawn-nya. Mempertahankan `_resolve`, jebakan PATH, dan overhead spawn —
  persis yang mau dibuang.

Bentuk shim juga yang membuat fase 3 murni penghapusan: karena fase 1 tidak
menulis ulang apa pun di hilir, mencabut CLI tidak menuntut satu pun konsumen
ditulis ulang.

### Yang sudah dibuktikan sebelum spec ini ditulis

Probe throwaway (tidak disimpan di repo) memancarkan baris stream-json
berbentuk claude untuk satu putaran tool lengkap, lalu menyuapkannya ke
`engine_stream.distill_claude_line` dan `engine_result.parse_claude_json` tanpa
mengubah kedua modul. Hasil: 9 `TraceEvent` dengan urutan benar, `file_path`
hanya muncul untuk tool edit, token diatribusikan sekali per giliran (bukan per
blok), `final_text` terbaca dari envelope, `api_error` tersurfacekan, dan input
rusak menghasilkan list kosong tanpa raise.

Satu temuan mengubah rancangan: `engine_stream._EDIT_TOOLS` mencocokkan nama
tool literal `{"Edit","Write","MultiEdit","NotebookEdit"}`. Menamai tool native
`write_file`/`edit_file` akan membuat daftar berkas-yang-diedit **diam-diam
kosong** — bukan error. Maka tool native memakai nama persis punya claude.

Baseline suite saat spec ditulis: 985 lulus.

### Yang belum dibuktikan

9Router memancarkan `tool_calls` untuk model yang terkonfigurasi
(`cc/claude-opus-5`). Gateway berjalan lokal di `http://127.0.0.1:20128/v1` dan
sedang mati saat probe dicoba. Ini prasyarat sebelum satu baris `engine_api.py`
ditulis; kalau gagal, seluruh rencana batal di titik itu.

## Arsitektur

Dua modul baru.

**`hermes/agent_tools.py`** — tool file/exec ter-scope. Tanpa state, tanpa
pengetahuan soal LLM. Ekspor `TOOLS` (schema OpenAI) dan
`async def call(name, args, cwd) -> str`.

Enam tool memakai nama persis punya claude: `Read`, `Edit`, `Write`, `Bash`,
`Grep`, `Glob`. Selain menjaga `_EDIT_TOOLS` tetap cocok, nama-nama itu adalah
yang model Claude sudah terlatih memakainya. Tool ketujuh, `ask_user`, tidak
punya padanan di claude dan memakai namanya sendiri.

Scoping lewat satu choke point — setiap tool yang menerima path melewatinya,
bukan lima pengecekan sendiri-sendiri:

```python
def _resolve_in(cwd: Path, path: str) -> Path:
    """The only way a tool turns an argument into a real path.

    Resolves symlinks before comparing: a link inside the project pointing at
    C:\\Windows would otherwise pass a plain prefix check.
    """
```

`Bash` berjalan lewat `create_subprocess_shell` dengan `cwd=proj`, timeout
sendiri yang lebih pendek dari timeout step, stdout+stderr digabung, dipotong
di ~8 KB dengan penanda potong eksplisit.

`ask_user` jadi tool native, bukan lewat MCP. `AskRegistry` di-inject langsung,
jadi tidak ada berkas config temporer, token, atau port seperti pada
`engine_runner.mcp_config_dict`. `MCP_CONFIG_FLAG` sengaja tidak memuat `"api"`.

**`hermes/engine_api.py`** — loop agentik.
`async def run(prompt, cwd, timeout_s, model, on_event, deadline, ...) -> RunResult`.

Memegang `AsyncOpenAI(base_url=settings.nvidia_base_url, api_key=secrets.nvidia_api_key)`.

### Kontrak yang dipertahankan persis

- Mengembalikan `RunResult` milik `engine_runner` apa adanya. `returncode`
  diisi `0`/`1` sintetis agar `failure.classify` dan log yang membacanya tidak
  berubah arti.
- `on_event` menerima baris stream-json berbentuk claude:
  `{"type":"system","subtype":"init"}`, lalu `assistant` per giliran, `user`
  berisi `tool_result` per hasil tool, dan `result` penutup. `stdout` adalah
  gabungan baris-baris itu.
- Konsekuensinya: `PARSERS["api"] = parse_claude_json` dan
  `DISTILLERS["api"] = distill_claude_line`. Dua entri dict.

Titik sambung, satu cabang di awal `run_engine` sebelum `_resolve`:

```python
if engine == "api":
    from . import engine_api
    return await engine_api.run(prompt, cwd, timeout_s, model=model,
                                deadline=deadline, on_event=on_event)
```

## Loop

Dua tingkat:

- **Luar** — `MAX_ENGINE_ROUNDS = 3` di orchestrator, tak disentuh. Ronde
  perbaikan.
- **Dalam** — giliran tool dalam satu sesi. Baru: `MAX_TURNS`, konstanta di
  `engine_api`, agar model yang nyangkut di loop tool tidak menghabiskan seluruh
  `timeout_code_s`.

```python
messages = [{"role": "system", "content": _system(cwd)},
            {"role": "user", "content": prompt}]
for _ in range(MAX_TURNS):
    turn = await _one_turn(client, model, messages, stream=True)   # emits the assistant line
    if not turn.tool_calls:
        break
    for tc in turn.tool_calls:            # sequential; every id MUST be answered
        result = await agent_tools.call(tc.name, tc.args, cwd)
        emit_tool_result(tc.id, result, is_error=...)
        messages.append({"role": "tool", "tool_call_id": tc.id, "content": result})
```

Satu baris `assistant` per **giliran**, bukan per delta: `distill_claude_line`
membaca blok konten utuh, dan CLI pun memancarkan per giliran.

**Jam.** `engine_runner._await_within` sudah generik — docstring-nya menyatakan
"what is awaited is not this function's concern". Dipakai ulang apa adanya,
sehingga `Deadline` yang berhenti selama operator menjawab `ask_user` bekerja
tanpa kode jam baru. Timeout menghasilkan `RunResult(False, "", "", True, None)`,
bentuk yang sama dengan cabang subprocess.

**Kontrak selesai.** `_confirmed_done` membaca `final_text`, yaitu field
`result` di envelope penutup. Envelope diisi **teks asisten terakhir**, bukan
output tool. Kalau tertukar, sentinel `DONE` tak pernah terbaca dan setiap step
menjalankan tiga ronde penuh — mahal dan senyap.

**Klasifikasi gagal.** Teks exception ditaruh di `stderr`, tempat `_why(res)`
mencarinya. Hasilnya benar tanpa kode tambahan: `401`/`403` → ENVIRONMENT,
berhenti seketika; `429`/`overloaded` → TRANSIENT, tunggu lalu ulangi. Perilaku
yang perlu diketahui: gateway mati memberi `connection refused`, yang ada di
daftar `_TRANSIENT` (`hermes/failure.py:43`) — dibaca "dunia sedang sibuk", tiga
ronde dengan backoff sebelum menyerah, bukan langsung "9Router belum nyala".
Diterima di fase 1.

### Tidak resumable di fase 1

`"api"` tidak masuk `RESUMABLE`. Menyimpan transkrip antar-ronde berarti dict
in-memory berkunci `session_id` yang tak pernah dibersihkan. Orchestrator sudah
punya perilaku waras untuk engine non-resumable: kirim ulang prompt beserta
`guidance` — persis yang dilakukan antigravity hari ini.

### Cost cap mati — kemunduran yang diterima sadar

9Router tidak melaporkan biaya, jadi `outcome.cost_usd` selalu `None`, jadi
`Budget.add` tak pernah bergerak, jadi `max_task_cost_usd` **tidak berlaku**
untuk engine ini. Hari ini cap itu hidup untuk claude CLI.

Ini satu-satunya kemunduran nyata dari perpindahan. `Budget` sendiri sudah
menuliskan alasan tidak menambalnya dengan tebakan: "inventing an estimate for
it would be a cap enforced against a number nobody measured"
(`hermes/orchestrator.py:359`). Fase 1 menerimanya; `MAX_TURNS` menjadi pagar
pengganti, dalam satuan giliran bukan dolar. Mengembalikan cap dolar menuntut
tabel harga per model di settings — keputusan fase 2, tidak diselundupkan
sekarang.

## Migrasi

### Fase 1 — aditif

| File | Perubahan |
|---|---|
| `hermes/agent_tools.py` | baru |
| `hermes/engine_api.py` | baru |
| `hermes/engine_runner.py` | cabang `engine == "api"`; `"api"` ke `STREAMING` + `MODEL_FLAG`; `PARSERS["api"]`; `Literal` di signature dilebarkan |
| `hermes/engine_stream.py:349` | `DISTILLERS["api"] = distill_claude_line` |
| `hermes/config.py:174` | `default_engine` Literal `+ "api"`; field `api_model: str = ""` (kosong = pakai `settings.model`); validator meminjam bentuk `_claude_model_shape` |
| `hermes/orchestrator.py:396` | `choose_engine` menerima `"api"`; blok `tuning` dapat cabang `api` |
| `hermes/project_resolve.py:38` | regex `+ api\|9router` |
| web | `types.ts:60`, `ConfigEngines.tsx:121`, `OfficeSessionChat.tsx:180`, siklus toggle `Dashboard.tsx:1513` |

Tidak berubah: skema DB (kolom `engine` teks bebas), `office_routes.py` (field
`engine` sudah `str`), dan `hermes_engine.spec` — `collect_submodules('hermes')`
(baris 45) sudah menyapu modul baru, sehingga jebakan "PYZ kehilangan
hermes.config" di v0.0.2 tidak terulang.

### Fase 2 — jadikan default

Satu baris: `orchestrator.py:403`, fallback `auto` dari
`"antigravity" if scope == "large" else "claude"` menjadi `"api"`. CLI masih
bisa dipanggil eksplisit lewat `!claude` atau setting.

Di sini juga tempat memutuskan cost cap: hidupkan lagi `max_task_cost_usd`
dengan tabel harga, atau terima `MAX_TURNS` sebagai pagar permanen.

### Fase 3 — hapus

Gerbang: engine `api` menyelesaikan task nyata tanpa jatuh ke CLI selama
periode yang ditentukan operator. Kalau tidak tercapai, fase 1 tetap bernilai
berdiri sendiri dan CLI dibiarkan.

- `engine_runner.py`: `COMMANDS`, `_argv`, `_resolve`, `_extra_tool_dirs`,
  `_pump`, `mcp_config_dict`, dan set `STDIN_PROMPT` / `EFFORT_FLAG` /
  `PRINT_TIMEOUT_FLAG` / `MCP_CONFIG_FLAG` / `RESUMABLE`. **`_await_within`
  tetap** — loop memakainya.
- `engine_result.py`: `parse_agy_stream`. `engine_stream.py`:
  `distill_agy_line` + helper `_AGY_*`.
- `ask_server.py` seluruhnya, plus wiring di `main.py:1250-1252` dan `lifespan=`
  di `main.py:1775`. Paling perlu hati-hati: pastikan tidak ada konsumen lain
  sebelum dicabut.
- `config.py`: `claude_model`, `claude_effort`, `agy_model` + dua validator.
- Test: 136 referensi di 7 berkas (`test_engine_stream.py` 48, `test_web_ui.py`
  24, `test_engine_runner.py` 17, `test_engine_result.py` 17, `test_config.py`
  13, `test_engine_loop.py` 12, `test_orchestrator.py` 5). Sebagian besar
  dihapus, bukan ditulis ulang.
- `web/src/api/trace.test.ts` kasus antigravity; opsi dropdown; komentar
  `TaskDetail.tsx:452`.
- README dan `docs/INTEGRATIONS.md` bagian engine.

## Testing

Semua offline kecuali satu gerbang manual. Tanpa framework baru —
`asyncio_mode = "auto"` sudah aktif di `pyproject.toml:40`.

**`tests/test_agent_tools.py`** — batas keamanan, jadi diuji paling dalam:

- `../../etc` dan path absolut di luar proyek ditolak
- escape lewat symlink ditolak; di Windows pembuatan symlink butuh privilese,
  jadi test-nya `skipif` bila gagal dibuat — dilewati, bukan dipalsukan hijau
- `Read`/`Write`/`Edit` round trip; `Edit` dengan `old_string` tak unik gagal
  jelas, bukan mengganti kemunculan pertama
- `Bash` berjalan di `cwd` yang benar, timeoutnya sendiri kena, output besar
  terpotong dengan penanda
- `Grep`/`Glob` tidak bocor ke luar scope

**`tests/test_engine_api.py`** — `AsyncOpenAI` palsu dengan respons terskrip,
pola yang sudah dipakai `conftest.py` untuk `main.AsyncOpenAI`:

- baris terpancar → `distill_claude_line` → urutan `TraceEvent` yang
  diharapkan, termasuk `file_path` hanya untuk tool edit
- envelope penutup berisi teks asisten terakhir → `_confirmed_done` melihat
  `DONE`
- setiap `tool_call_id` dijawab sebelum permintaan berikutnya
- tool gagal → `is_error` → `ok=False` di trace
- `MAX_TURNS` menghentikan loop
- teks exception mendarat di `stderr` → `failure.classify` memberi kelas benar
  untuk 401, 429, dan connection refused
- timeout → `RunResult(timed_out=True)`
- fragmen argumen tool dari streaming tersusun ulang utuh

**`tests/test_engine_runner.py`** — tambahan: `engine="api"` tak pernah
menyentuh `_resolve` maupun `create_subprocess_exec`.

**Gerbang regresi fase 1**: 985 test yang ada tetap hijau. Karena fase 1
aditif, satu pun yang merah berarti sisipan bocor ke jalur lama.

**Gerbang manual** (butuh gateway hidup; prasyarat fase 2, bukan fase 1):

1. probe tool-calling yang tertunda — non-stream, round-trip `tool_calls` →
   `role: tool`, dan streaming dengan `include_usage`
2. satu task nyata end-to-end di repo scratch, dibandingkan dengan `!claude`
   pada task yang sama
