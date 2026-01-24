module.exports = {
  apps: [
    {
      name: "bot-discord",
      script: "./index.js",
      watch: false,             // Não reinicia automaticamente ao detectar mudanças (evita duplicação)
      instances: 1,             // Apenas 1 instância do bot
      autorestart: true,        // Reinicia caso dê crash
      max_memory_restart: "300M", // Reinicia se passar de 300MB
      env: {
        NODE_ENV: "production",
        TOKEN: process.env.TOKEN, // Seu token do Discord
        PORT: process.env.PORT || 10000
      }
    }
  ]
};
