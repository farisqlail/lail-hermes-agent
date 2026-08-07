# Chat yang mengimplementasikan kode

Tanggal: 2026-08-07
Status: disetujui, siap direncanakan

## Masalah

Operator meminta perubahan kode lewat panel chat. Agent membalas dengan patch
lengkap dan penjelasan, tetapi tidak ada berkas yang berubah di proyek. Operator
harus menyalin patch itu sendiri.

Ini bukan kegagalan engine. `run_engine` menjalankan `claude -p
--dangerously-skip-permissions` dan memang menulis berkas. Yang tidak pernah
terjadi adalah jalannya: chat tidak pernah sampai ke sana.

Dua lapis penyebab:

1. **Routing.** `hermes/main.py:357` menyuruh agent memanggil `start_task`
   "hanya bila pengguna jelas meminta menjalankan sesuatu". "Tambahkan
   `nota_offline` di sync offline" tidak terbaca sebagai permintaan
   *menjalankan*, jadi agent menjawab dari pengetahuannya sendiri dan tool tidak
   pernah dipanggil.
2. **Eksekusi.** Andai `start_task` dipanggil pun, `telegram_bridge.handle_task`
   menahan setiap task yang berasal dari chat di `awaiting_confirm` tanpa
   syarat, menunggu operator menekan Run.

## Keputusan

Permintaan kode dari chat yang menyebut sebuah proyek harus **diantre dan
langsung dijalankan**, selama proyeknya bisa dipulihkan dan pekerjaannya tidak
berisiko. Bila syarat itu gagal, task turun ke `awaiting_confirm` beserta
alasannya — tidak pernah batal diam-diam, tidak pernah jalan diam-diam.

Aksi berisiko (git push, deploy, hapus berkas, path di luar proyek) **selalu**
minta konfirmasi, termasuk ketika setelan `confirm_risky` dimatikan.

Pemicunya adalah penyebutan proyek: kalimat yang menyebut `@proyek` dan
menyangkut kode dikerjakan; tanya-jawab tanpa `@proyek` dijawab saja.

## Kenapa pendekatan ini

Gate yang dibutuhkan sudah ada. `handle_task` menghitung `reasons` dari
`detect_risky(text)` (push/deploy/delete/path luar) ditambah probe git yang
melaporkan `dirty` atau "tidak ada undo git yang bisa dipakai". Daftar itu persis
himpunan prasyarat yang diinginkan.

Task chat tidak pernah auto-run bukan karena `reasons` — melainkan karena
`handle_task` menyuntikkan alasan buatan:

```python
must_confirm = force_confirm and bool(self.ask_confirm)
if must_confirm and not reasons:
    reasons = ["dimulai oleh asisten chat — konfirmasi sebelum menjalankan"]
```

Suntikan itu menjamin daftar alasan tidak pernah kosong untuk task chat, jadi
cabang auto-run tidak pernah tercapai. Menghapusnya membuat task chat dinilai
dengan ukuran yang sama seperti `/task`.

Dua alternatif ditolak:

- **Parameter `auto_run` terpisah di `handle_task`.** Lebih terbaca di signature,
  tetapi menduplikasi logika gate dan menambah kombinasi flag (`force_confirm` ×
  `auto_run`) yang harus diuji tanpa menambah perilaku.
- **Auto-confirm dari `web_ui`.** Menilai risiko di dalam dispatch lalu memanggil
  `resolve_confirm` akan menaruh logika gate di dua berkas; keduanya akan
  melenceng begitu `_RISKY_PATTERNS` berubah.

## Bagian 1 — gate eksekusi

Berkas: `hermes/telegram_bridge.py`, di dalam `handle_task`.

1. Hapus suntikan alasan buatan (baris 178-179).
2. Tambah satu alasan untuk task chat yang tidak menyebut proyek:

   ```
   force_confirm and proj is None
     -> "tidak ada proyek yang disebut — kerja akan jatuh ke workspace kosong"
   ```

   Tanpa ini `orchestrator.run_task` membuat workspace buangan di
   `projects/<task_id>` (orchestrator.py:426-430) dan mengerjakan sesuatu yang
   tidak diminta operator.
3. Tambah satu alasan untuk task chat yang proyeknya tidak bisa diperiksa:

   ```
   force_confirm and proj is not None and self.git_dirty is None
     -> "status git tidak bisa diperiksa — tidak ada bukti run ini bisa dibatalkan"
   ```

   `Bridge` memperlakukan `git_dirty` yang tidak terpasang sebagai "lewati
   pemeriksaan dirty-tree" — docstring `main._build_bridge` (main.py:665-667)
   sudah memperingatkan bahwa injeksi yang hilang mematikan gate tanpa satu tes
   pun memerah. Untuk auto-run, diam itu harus dibaca sebagai berhenti.
4. Persempit penolakan "tidak ada kanal konfirmasi" (baris 172-176) menjadi
   `force_confirm and reasons and not self.ask_confirm`. Tanpa alasan, tidak ada
   yang perlu ditanyakan, jadi tidak ada yang perlu dibatalkan.

`must_confirm` sudah tidak melihat `confirm_risky`, jadi cabang
`if reasons and (gate_live or must_confirm)` yang ada sudah memenuhi aturan
"risky selalu konfirmasi" tanpa perubahan.

Alur setelah perubahan:

| Permintaan chat | Hasil |
|---|---|
| `@proyek` + git bersih + non-risky | jalan langsung |
| `@proyek` + ada perubahan belum di-commit | `awaiting_confirm`, alasan disebut |
| `@proyek` + bukan repo git / git tak tersedia | `awaiting_confirm` |
| `@proyek` + probe git tidak terpasang | `awaiting_confirm` |
| teks berisiko (push/deploy/delete) | `awaiting_confirm`, walau `confirm_risky=False` |
| tanpa `@proyek` | `awaiting_confirm` |

## Bagian 2 — routing

Berkas: `hermes/main.py` (system prompt chat), `hermes/web_ui.py` (deskripsi tool
`start_task`). Semuanya suntingan teks prompt.

1. **Aturan pemicu** menggantikan `main.py:355-360`: permintaan yang menyebut
   `@proyek` dan menyangkut kode atau berkas wajib memanggil `start_task`, dan
   agent dilarang menulis patch, diff, atau blok kode implementasi di jawaban
   chat. Tanpa `@proyek`, permintaan dijawab sebagai diskusi.

   Larangan menulis kode inline adalah bagian yang menanggung beban: tanpa itu
   model puas dengan mengusulkan patch dan tool tidak pernah terpanggil — persis
   kegagalan yang memicu spec ini.

2. **Perbaiki klaim yang jadi salah.** `main.py:357` ("kamu tidak pernah
   benar-benar menjalankan kode sendiri") dan `web_ui.py:95` ("Task TIDAK
   berjalan sampai operator menekan Run") keliru untuk jalur bersih. Ganti
   dengan kontrak sebenarnya: task jalan sendiri bila proyek disebut, git
   bersih, dan pekerjaannya tidak berisiko; selain itu ditahan menunggu Run.

3. **Hapus jawaban kalengan** `main.py:395-412`. Tabel "Saya hanya mengantrekan
   task" mengajarkan kontrak lama kata demi kata. Hapus, jangan ditulis ulang;
   aturan (1) sudah menggantikan isinya. Periksa `_NO_CONFIRM_NOTE`
   (`main.py:321`) tidak bertabrakan dengan kontrak baru.

Yang tetap berlaku: dilarang mengarang task ID, dilarang mengaku sudah selesai
sebelum hasil tool mengatakannya.

## Bagian 3 — status yang jujur

`web_ui.py:414-417` mengembalikan `"status": "awaiting_confirm"` sebagai
konstanta, padahal `handle_task` baru saja dilepas sebagai task background dan
belum memutuskan apa pun. Setelah auto-run ada, nilai itu salah separuh waktu,
dan model akan memberi tahu operator "menunggu Run" ketika engine sudah mengedit
berkas.

`handle_task` menerima callback opsional `on_decision(status, reasons)`,
dipanggil tepat satu kali sebelum ia menahan atau menjalankan. Dispatch
`start_task` membuat `asyncio.Future`, mengisinya lewat callback itu, menunggu
dengan timeout pendek, lalu mengembalikan status sebenarnya beserta alasannya.
Pekerjaannya sendiri tetap di background — yang ditunggu hanya keputusan gate.

Bila timeout terlampaui, dispatch mengembalikan status "queued" apa adanya dan
menyatakan keputusan belum diketahui. Menebak akan mengulang bug yang sedang
diperbaiki.

## Bagian 4 — pengujian

Tiga tes mengunci perilaku lama dan harus dibalik, bukan dihapus:

| Tes | Sekarang | Menjadi |
|---|---|---|
| `tests/test_telegram_bridge.py:172` `test_force_confirm_holds_a_nonrisky_task` | task chat non-risky ditahan | proyek bersih + non-risky → jalan, `ask_confirm` tidak dipanggil |
| `tests/test_telegram_bridge.py:196` `test_force_confirm_refuses_without_a_confirm_channel` | selalu batal tanpa kanal konfirmasi | batal hanya bila ada alasan; tanpa alasan → jalan |
| `tests/test_web_ui.py:559` di `test_chat_tools_query_state_and_propose_task` | `start_task` → `awaiting_confirm` | status berasal dari `on_decision` |

Tes baru, satu per cabang gate, memakai `FakeOrch` dan stub `git_dirty` yang
sudah ada di suite:

1. proyek bersih + non-risky + `@proyek` → orchestrator dipanggil dan
   `ask_confirm` tidak (diperiksa lewat `FakeOrch`, bukan lewat string status,
   yang milik orchestrator)
2. `git_dirty` mengembalikan `True` → `awaiting_confirm`, alasan menyebut
   perubahan belum di-commit
3. `git_dirty` mengembalikan `None` → `awaiting_confirm`
4. teks berisiko dengan `confirm_risky=False` → tetap `awaiting_confirm`
5. tanpa `@proyek` → `awaiting_confirm`, alasan menyebut proyek tidak disebut
6. `git_dirty` tidak terpasang → `awaiting_confirm`
7. dispatch `start_task` mengembalikan status hasil keputusan gate, bukan
   konstanta

Isi prompt tidak dites. Menyamakan string prompt dengan literal mengunci
kata-katanya, bukan perilakunya, dan membuat tiap penyuntingan prompt jadi tes
merah palsu.

## Di luar cakupan

- Menjalankan engine langsung di dalam giliran chat (tanpa catatan task, log,
  atau tombol Cancel).
- Saklar "mode kerjakan" di UI.
- Tool `implement` terpisah dari `start_task`.
- Perubahan pada jalur `/task` Telegram, yang memakai `force_confirm=False` dan
  tidak tersentuh.
