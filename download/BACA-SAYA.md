# Unduh ZIP portable (dipecah)

ZIP asli 150 MB dipecah menjadi beberapa bagian (`.part000`, `.part001`, ...) karena batas 100 MB per file GitHub.

## Gabungkan di Windows (Command Prompt, di folder ini)
```
copy /b Canvaset-0.1.0-win-x64-portable.zip.part000 + Canvaset-0.1.0-win-x64-portable.zip.part001 + Canvaset-0.1.0-win-x64-portable.zip.part002 Canvaset-0.1.0-win-x64-portable.zip
```
(sesuaikan jumlah bagian dengan berkas yang ada). Atau PowerShell:
```
Get-Content Canvaset-0.1.0-win-x64-portable.zip.part* -Encoding Byte -ReadCount 0 | Set-Content Canvaset-0.1.0-win-x64-portable.zip -Encoding Byte
```
Verifikasi: `certutil -hashfile Canvaset-0.1.0-win-x64-portable.zip SHA256` harus sama dengan `SHA256.txt`.

Lalu ekstrak ZIP dan jalankan `Canvaset.exe`. Catatan: belum diuji di Windows dan tidak ditandatangani.
