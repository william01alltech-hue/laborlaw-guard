# 使用官方輕量 Node.js LTS 映象檔
FROM node:20-alpine

# 設定工作目錄
WORKDIR /app

# 設定生產環境變數
ENV NODE_ENV=production
ENV PORT=3000

# 複製 package 依賴描述檔
COPY package.json ./

# 安裝相依套件（目前皆為純原生模組，此處確保一致性）
RUN npm install --omit=dev --ignore-scripts

# 複製所有專案原始碼
COPY . .

# 對外開放連接埠
EXPOSE 3000

# 啟動伺服器
CMD ["node", "server.js"]
