# Third-party notices / 第三方元件說明

This project does **not** redistribute any of the following; they are downloaded at install time.
本專案不隨附下列任何元件,皆在安裝時由官方來源下載。

| Component | Purpose | License | Source |
|---|---|---|---|
| MediaPipe (Python) | Pose estimation runtime | Apache-2.0 | https://github.com/google-ai-edge/mediapipe |
| MediaPipe Pose Landmarker (heavy) `.task` model | Body landmark detection | See Google's model card — **not bundled**, downloaded from Google's storage on first use | https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker |
| OpenCV (`opencv-python-headless`) | Video decoding / frames | Apache-2.0 (the wheel also bundles FFmpeg under LGPL) | https://github.com/opencv/opencv-python |
| Flask | Local web server | BSD-3-Clause | https://github.com/pallets/flask |
| NumPy | Numerics | BSD-3-Clause | https://github.com/numpy/numpy |
| uv (installer only) | Fetches Python 3.12 and packages | MIT / Apache-2.0 | https://github.com/astral-sh/uv |

## Target ranges (`ranges.json`)
The numeric targets are starting points drawn from public fitting literature and fitter guides, paraphrased
with sources noted in the file (e.g. Acta Bioeng Biomech 2019, Velogic, BikeFittr, Working Triathlete, Retül).
They are rules of thumb, not validated standards, and this project is not affiliated with or endorsed by any of them.
All brand names are trademarks of their respective owners.
目標範圍數值取自公開的 fitting 文獻與指南(以自己的話改寫並在檔內註明出處),屬經驗法則,不代表任何單位背書;品牌名稱為各自所有者的商標。

## User-supplied media / 使用者自備的影片
No rider footage and no professional-rider data ship with this repository. If you upload videos of other people
(e.g. professional riders), make sure you have the right to use them; the app only stores derived joint angles
and frames **on your own computer**.
本專案不含任何騎乘影片或職業選手資料。若你上傳他人影片(例如職業選手),請確認你有使用權;資料只存在你自己的電腦。
