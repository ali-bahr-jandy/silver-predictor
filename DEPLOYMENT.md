# CI/CD Deployment Setup Guide

This repository is configured for automatic deployment to your server using GitHub Actions.

## Setup Instructions

### 1. Server Preparation

SSH into your server and run:

```bash
# Navigate to your deployment directory
cd /path/to/your/apps  # Change this to your preferred location

# Clone the repository
git clone https://github.com/ali-bahr-jandy/silver-predictor.git
cd silver-predictor

# Create .env file with your environment variables
nano .env
```

Add your environment variables to `.env`:

```env
# Database
DB_HOST=postgres
DB_PORT=5432
DB_USERNAME=postgres
DB_PASSWORD=postgres
DB_NAME=silver_predictor

# Telegram Bot
TELEGRAM_BOT_TOKEN=your_bot_token
TELEGRAM_CHAT_ID=your_chat_id

# Noghresea API
NOGHRESEA_USERNAME=your_username
NOGHRESEA_PASSWORD=your_password

# OpenAI
OPENAI_API_KEY=your_openai_key

# Other configs
PORT=3000
```

### 2. GitHub Secrets Setup

Go to your GitHub repository: https://github.com/ali-bahr-jandy/silver-predictor

1. Click on **Settings** → **Secrets and variables** → **Actions**
2. Click **New repository secret** and add these secrets:

| Secret Name       | Description              | Example                            |
| ----------------- | ------------------------ | ---------------------------------- |
| `SERVER_HOST`     | Your server IP or domain | `123.45.67.89` or `example.com`    |
| `SERVER_USERNAME` | SSH username             | `root` or `ubuntu`                 |
| `SSH_PRIVATE_KEY` | Your SSH private key     | Copy from `~/.ssh/id_rsa`          |
| `SERVER_PORT`     | SSH port (optional)      | `22` (default)                     |
| `DEPLOY_PATH`     | Full path on server      | `/home/user/apps/silver-predictor` |

### 3. Generate SSH Key (if needed)

If you don't have an SSH key on your server:

```bash
# On your server
ssh-keygen -t rsa -b 4096 -C "github-actions"

# Add the public key to authorized_keys
cat ~/.ssh/id_rsa.pub >> ~/.ssh/authorized_keys

# Copy the private key to add to GitHub secrets
cat ~/.ssh/id_rsa
```

### 4. Install Docker on Server (if not installed)

```bash
# Install Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sh get-docker.sh

# Install Docker Compose
sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose

# Add user to docker group (optional, to run without sudo)
sudo usermod -aG docker $USER
```

### 5. First Deployment

Test the deployment manually on your server:

```bash
cd /path/to/silver-predictor
./deploy.sh
```

### 6. Automatic Deployment

Now, every time you push to the `main` branch:

1. GitHub Actions will trigger automatically
2. Connect to your server via SSH
3. Pull the latest code
4. Rebuild and restart Docker containers
5. Clean up old images

### Deployment Commands

```bash
# View logs
docker-compose logs -f app

# Check status
docker-compose ps

# Restart services
docker-compose restart

# Stop all services
docker-compose down

# Manual deployment
./deploy.sh
```

### Troubleshooting

**GitHub Action fails to connect:**

- Verify SSH_PRIVATE_KEY secret is correct (entire key including headers)
- Check SERVER_HOST and SERVER_USERNAME
- Ensure firewall allows SSH connections

**Docker build fails:**

- Check .env file exists on server
- Verify environment variables are set correctly
- Check Docker logs: `docker-compose logs`

**App won't start:**

- Check logs: `docker-compose logs app`
- Verify database is running: `docker-compose ps`
- Ensure .env file has all required variables
