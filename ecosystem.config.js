module.exports = {
  apps: [
    {
      name: 'bot-discord',
      script: './index.js',
      watch: true,
      env: {
        NODE_ENV: 'production',
      },
      error_file: './logs/error.log',
      out_file: './logs/out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
    },
  ],
};
