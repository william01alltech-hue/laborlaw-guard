# 🚀 勞工守護神 - 正式上線與部署指引

本系統為輕量級高效架構，前端採用現代化 PWA，後端基於 Node.js 原生 HTTP 模組，不依賴龐雜肥大的第三方套件，啟動極速且極省資源。

---

## 方案一：使用 Render.com 一鍵免費上線（最推薦，適合所有人）

Render 提供免費的 Web Service，自帶免費 HTTPS SSL 憑證與全球 CDN。

### 步驟：
1. **將程式碼推送到 GitHub**：
   ```bash
   git init
   git add .
   git commit -m "feat: initial commit for laborlaw guard"
   # 推送至你的 GitHub repository
   ```
2. **登入 [Render.com](https://render.com)**：
   - 點擊右上角 **New +** -> 選擇 **Web Service**。
   - 連接你的 GitHub 倉庫 `laborlaw-guard`。
3. **設定基本參數**：
   - **Environment**：`Node`
   - **Build Command**：`npm install`
   - **Start Command**：`node server.js`
   - **Plan Type**：`Free`
4. **設定環境變數（可選）**：
   - `GROQ_API_KEY`：若填入 Groq 的 API 金鑰，AI 諮詢會啟用 Qwen 3.8-27B 深度三段論推論；若不填，系統會自動切換為內建的「智慧本地令函檢索引擎」，依然能夠精準回答！
5. **點擊 Create Web Service**：
   - 約 1~2 分鐘後，Render 即會分配一個網址，例如：`https://laborlaw-guard.onrender.com`。
   - 直接把該網址分享給勞工朋友們即可使用！

---

## 方案二：使用 Zeabur 部署（台灣/亞太地區延遲極低）

Zeabur 對台灣網路非常友善，且部署幾乎零門檻。

### 步驟：
1. 前往 [Zeabur 官方網站](https://zeabur.com) 並用 GitHub 登入。
2. 建立新專案，點擊 **Deploy New Service** -> 選擇 **GitHub**。
3. 選擇本專案倉庫，Zeabur 會自動識別 Node.js / Dockerfile 並開始部署。
4. 部署完成後，點擊 **Networking** -> **Generate Domain**，即可獲得免費的 `xxxx.zeabur.app` 網址。

---

## 方案三：使用 Docker 部署至自有伺服器 / VPS

如果貴公司或團隊已有 Linux 伺服器（Ubuntu / Debian / CentOS 等）：

```bash
# 1. 建置 Docker 映像檔
docker build -t laborlaw-guard:latest .

# 2. 背景常駐執行（對外映射 3000 port）
docker run -d \
  --name laborlaw-guard \
  --restart always \
  -p 3000:3000 \
  -e GROQ_API_KEY="你的_GROQ_API_KEY" \
  laborlaw-guard:latest
```

搭配 Nginx 反向代理並申請 Let's Encrypt 免費 SSL 憑證即可綁定專屬網域名稱（例如：`https://laborlaw.yourdomain.com`）。

---

## 方案四：臨時展示 / 搶先分享（免伺服器，10 秒搞定）

若您現在就想發給幾位朋友或同事測試，可使用免費內網穿透工具：

### 方式 A：Cloudflare Tunnel（完全免費且免註冊）
```bash
# 安裝 cloudflared (macOS)
brew install cloudflared

# 一鍵映射本機 3001 埠號
cloudflared tunnel --url http://localhost:3001
```
終端機會立即產生一個公開的 `https://xxxx.trycloudflare.com` 專屬臨時網址，任何人手機直接打開即可使用！

### 方式 B：ngrok
```bash
ngrok http 3001
```

---

## 📲 如何讓使用者將「勞工守護神」加入手機桌面當 App？

本系統已經完整配置 **PWA (Progressive Web App)**：
- **iPhone (iOS Safari)**：
  打開線上網址 -> 點擊底部的 **「分享」按鈕（向上箭頭）** -> 選擇 **「加入主畫面」**。
- **Android (Chrome)**：
  打開線上網址 -> 點擊右上角選單（三個點） -> 選擇 **「安裝應用程式」** 或 **「新增至主螢幕」**。

安裝後會擁有專屬 App 圖示、全螢幕開啟（無網址列），就像原生 App 一樣流暢！
