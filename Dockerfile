# Use a Node.js image as the base
FROM node:18-alpine

# Set the working directory
WORKDIR /usr/src/app

# Copy package.json and install dependencies
COPY package*.json ./
RUN npm install

# Copy the application code
COPY . .

# Expose the port Cloud Run will use
EXPOSE 8080

# Start the backend application
CMD ["npm", "start"]
