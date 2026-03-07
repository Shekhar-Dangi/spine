# azurerm v4 requires subscription_id — set via ARM_SUBSCRIPTION_ID env var
# or pass explicitly: terraform apply -var="subscription_id=<uuid>"
provider "azurerm" {
  subscription_id = var.subscription_id
  features {}
}
