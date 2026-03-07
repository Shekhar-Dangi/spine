terraform {
  required_version = ">= 1.5"

  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 4.0"
    }
  }

  backend "azurerm" {
    resource_group_name  = "rg-spine-prod"
    storage_account_name = "stspineprodtf"
    container_name       = "tfstate"
    key                  = "spine.tfstate"
  }
}
