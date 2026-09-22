"""Privacy policy and terms: linked from Settings and required by the Play Store."""
import pytest


@pytest.mark.parametrize("path", ["/privacy", "/terms"])
def test_legal_page_is_served_as_complete_html(client, path):
    response = client.get(path)
    assert response.status_code == 200
    assert response.content_type.startswith("text/html")
    body = response.get_data(as_text=True)
    assert "{{" not in body  # every placeholder filled
    assert "mailto:" in body


def test_privacy_policy_states_calls_are_not_recorded(client):
    # The app has no recording path; the policy must keep saying so accurately.
    assert "do not record calls" in client.get("/privacy").get_data(as_text=True)


def test_home_page_describes_the_app_and_links_the_policies(client):
    # Meta's WhatsApp business setup asks for a website and its reviewers open it.
    response = client.get("/")
    assert response.status_code == 200
    assert response.content_type.startswith("text/html")
    body = response.get_data(as_text=True)
    assert "{{" not in body
    for link in ('href="/privacy"', 'href="/terms"', "mailto:"):
        assert link in body
