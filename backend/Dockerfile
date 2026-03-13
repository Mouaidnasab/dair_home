# Use official Python image
FROM python:3.12-slim

# Set working directory
WORKDIR /app

# Copy requirements (if you have one)
COPY requirements.txt .

# Install dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Copy the rest of your application
COPY . .

# Create a directory for persistent data
RUN mkdir -p /app/data

# Define the volume
VOLUME ["/app/data"]

# Expose FastAPI default port
EXPOSE 8000

# Command to run the FastAPI app using uvicorn
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
