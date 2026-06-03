module.exports = {
    apps: [
        {
            name: "api-tp",
            script: "dist/index.js",
            env: {
                PORT: 8005,
                DEV: 0
            },
            log_date_format: "DD/MM HH:mm:ss"
        },
        {
            name: "cron-tp",
            script: "dist/cron-worker.js",
            env: {
                DEV: 0,
                CRON_ON: 1
            },
            log_date_format: "DD/MM HH:mm:ss"
        }
    ]
}

