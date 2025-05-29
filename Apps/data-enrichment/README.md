# 📦 Data Enrichment Module

Enhances and normalizes product and user data for better AI processing and catalog integration.

## ✅ Features

- Hash generation based on product attributes and images
- Deduplication using AI clustering
- Attribute normalization (size, color, brand)
- Image hashing and comparison
- Product-to-need mapping using Maslow hierarchy

## ⚙️ Workflow Stages

1. **Ingest** — raw product data from API/form
2. **Process** — extract physical and semantic features
3. **Hash** — create unique product identity
4. **Store** — update PostgreSQL normalized tables

## 🔧 Technologies

- n8n workflows (`data-enrichment.json`)
- Python scripts for hashing (optional)
- PostgreSQL schema: `products_raw`, `products_normalized`

## 📊 Outputs

- Cleaned product catalog
- AI-ready input for recommendation models
- Detection of duplicates and fraud-prone patterns
