import pytest
from unittest.mock import MagicMock, patch

from core.schema import TenantConfig, UserPayload
from providers.slack_provider import SlackProvider
from slack_sdk.web.slack_response import SlackResponse

@pytest.fixture
def mock_tenant_config():
    return TenantConfig(
        tenant_id="ACME",
        domain="acme.com",
        org_name="Acme Corp",
        slack_bot_token="xoxb-secret-token",
        slack_role_channels={"engineering": ["C123"]}
    )

@pytest.fixture
def mock_user():
    return UserPayload(
        user_id="u-001",
        email="test@acme.com",
        first_name="Test",
        last_name="User",
        role="engineering"
    )

@patch("providers.slack_provider.WebClient")
def test_provision_success(mock_client_cls, mock_tenant_config, mock_user):
    mock_client = MagicMock()
    mock_client_cls.return_value = mock_client
    
    # Mock lookupByEmail
    mock_client.users_lookupByEmail.return_value = {"user": {"id": "U12345"}}
    
    # Mock conversations_list
    mock_client.conversations_list.return_value = {
        "channels": [
            {"name": "engineering", "id": "C123"},
            {"name": "social", "id": "C456"}
        ]
    }
    
    # Mock conversations_invite
    mock_client.conversations_invite.return_value = {}
    
    # Mock conversations_open
    mock_client.conversations_open.return_value = {"channel": {"id": "D123"}}
    
    # Mock chat_postMessage
    mock_client.chat_postMessage.return_value = {}
    
    provider = SlackProvider(mock_tenant_config)
    result = provider.provision(mock_user)
    
    assert result["status"] == "provisioned"
    assert result["slack_user_id"] == "U12345"
    
    mock_client.users_lookupByEmail.assert_called_once_with(email="test@acme.com")
    mock_client.chat_postMessage.assert_called_once()
    assert "Primitive Onboarding" in mock_client.chat_postMessage.call_args[1]["text"]

@patch("providers.slack_provider.WebClient")
def test_health_check_success(mock_client_cls, mock_tenant_config):
    mock_client = MagicMock()
    mock_client_cls.return_value = mock_client
    
    # Needs to return an object with a get method for the Slack provider's check
    mock_response = MagicMock(spec=SlackResponse)
    mock_response.get.return_value = True
    mock_client.auth_test.return_value = mock_response
    
    provider = SlackProvider(mock_tenant_config)
    assert provider.health_check() is True

@patch("providers.slack_provider.WebClient")
def test_health_check_failure(mock_client_cls, mock_tenant_config):
    mock_client = MagicMock()
    mock_client_cls.return_value = mock_client
    
    # Needs to return an object where get("ok") returns False
    mock_response = MagicMock(spec=SlackResponse)
    mock_response.get.return_value = False
    mock_client.auth_test.return_value = mock_response
    
    provider = SlackProvider(mock_tenant_config)
    assert provider.health_check() is False
