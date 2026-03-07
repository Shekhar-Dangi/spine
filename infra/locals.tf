locals {
  common_tags = {
    Environment = var.env
    ManagedBy   = "Terraform"
    Project     = "spine"
  }
}
