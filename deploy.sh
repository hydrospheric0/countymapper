#!/bin/bash

# County Mapper GitHub Pages Deployment Script
echo "🚀 Deploying County Mapper to GitHub Pages..."

# Check if git is initialized
if [ ! -d ".git" ]; then
    echo "📦 Initializing Git repository..."
    git init
    git branch -M main
fi

# Add all files
echo "📄 Adding files..."
git add .

# Commit changes
echo "💾 Committing changes..."
git commit -m "Deploy County Mapper to GitHub Pages"

# Add remote if it doesn't exist
if ! git remote get-url origin > /dev/null 2>&1; then
    echo "🔗 Adding GitHub remote..."
    echo "Please replace 'yourusername' with your actual GitHub username:"
    echo "git remote add origin https://github.com/yourusername/countymapper.github.io.git"
    read -p "Enter your GitHub username: " username
    git remote add origin "https://github.com/$username/countymapper.github.io.git"
fi

# Push to GitHub
echo "📤 Pushing to GitHub..."
git push -u origin main

echo "✅ Deployment complete!"
echo "🌐 Your site will be available at: https://countymapper.github.io"
echo "⏱️  It may take a few minutes for GitHub Pages to build and deploy."
