variable "db_password" {
  description = "PostgreSQL administrator password"
  type        = string
  sensitive   = true
}

variable "env" {
  description = "Environment name (e.g. prod, staging)"
  type        = string
  default     = "prod"
}

variable "frontend_url" {
  description = "Frontend URL for CORS (e.g. https://your-app.vercel.app)"
  type        = string
}

variable "jwt_secret" {
  description = "JWT signing secret (minimum 32 characters)"
  type        = string
  sensitive   = true
}

variable "location" {
  description = "Azure region"
  type        = string
  default     = "centralindia"
}

variable "setup_key" {
  description = "SPINE_SETUP_KEY for initial admin account creation"
  type        = string
  sensitive   = true
}

variable "subscription_id" {
  description = "Azure subscription ID (can also be set via ARM_SUBSCRIPTION_ID env var)"
  type        = string
}

variable "tavily_api_key" {
  description = "Tavily API key for web search in dossier generation (optional)"
  type        = string
  sensitive   = true
  default     = ""
}
