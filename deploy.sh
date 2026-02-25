#!/bin/bash
cd ~/gtc-form
git pull origin main
cp -r client/gtc-form/* /var/www/gtc-form/
sudo systemctl reload nginx
