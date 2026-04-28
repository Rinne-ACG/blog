@echo off
cd /d D:\boke\blog
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/Rinne-ACG/blog.git
git push -u origin main
pause
