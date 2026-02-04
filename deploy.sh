#!/bin/bash

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${YELLOW}Starting deployment...${NC}"

# Pull latest code
echo -e "${YELLOW}Pulling latest code from GitHub...${NC}"
git pull origin main

if [ $? -ne 0 ]; then
    echo -e "${RED}Failed to pull code from GitHub${NC}"
    exit 1
fi

# Stop and remove old containers
echo -e "${YELLOW}Stopping old containers...${NC}"
docker-compose down

# Build and start new containers
echo -e "${YELLOW}Building and starting new containers...${NC}"
docker-compose up -d --build

if [ $? -ne 0 ]; then
    echo -e "${RED}Failed to start containers${NC}"
    exit 1
fi

# Clean up old images
echo -e "${YELLOW}Cleaning up old Docker images...${NC}"
docker image prune -f

echo -e "${GREEN}Deployment completed successfully!${NC}"

# Show running containers
echo -e "${YELLOW}Running containers:${NC}"
docker-compose ps
