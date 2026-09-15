# ==========================================
# STAGE 1: Build dell'applicazione con Node
# ==========================================
FROM node:18-alpine AS builder

# Imposta la directory di lavoro nel container
WORKDIR /app

# Copia solo i file delle dipendenze per sfruttare la cache di Docker
COPY package*.json ./

# Installa le librerie
RUN npm install --legacy-peer-deps

# Copia tutto il codice sorgente
COPY . .

# Compila l'applicazione (Vite genererà i file statici nella cartella 'dist')
RUN npm run build

# ==========================================
# STAGE 2: Serve dell'applicazione con Nginx
# ==========================================
FROM nginx:alpine

# Rimuove la pagina di benvenuto di default di Nginx
RUN rm -rf /usr/share/nginx/html/*

# Copia i file statici generati dallo Stage 1 nella cartella pubblica di Nginx
COPY --from=builder /app/dist /usr/share/nginx/html

# Copia la configurazione personalizzata per far funzionare React Router
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Espone la porta 80 del container
EXPOSE 80

# Avvia Nginx in background
CMD ["nginx", "-g", "daemon off;"]