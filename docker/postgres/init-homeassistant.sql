SELECT 'CREATE DATABASE homeassistant'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'homeassistant')\gexec
