import pytest
from fastapi.testclient import TestClient
from app import app

client = TestClient(app)


def test_health():
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_allocate_static():
    payload = {"mode": "static", "rolling_horizon_steps": 1, "vehicle_type": "truck"}
    response = client.post("/allocate", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert "flows" in data
    assert "unmet_demand" in data
    assert isinstance(data["flows"], list)
    assert isinstance(data["unmet_demand"], list)


def test_allocate_rolling():
    payload = {"mode": "rolling", "rolling_horizon_steps": 2, "vehicle_type": "truck"}
    response = client.post("/allocate", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert "robust_margin" in data


def test_allocate_with_hitl():
    payload = {
        "mode": "static",
        "rolling_horizon_steps": 1,
        "vehicle_type": "bike",
        "hitl": {
            "weights": {"S3": 3.0},
            "force_node": {"H2": True},
            "force_route": {"E1": False}
        }
    }
    response = client.post("/allocate", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert "explanations" in data


def test_allocate_invalid_mode():
    payload = {"mode": "invalid", "rolling_horizon_steps": 1, "vehicle_type": "truck"}
    response = client.post("/allocate", json=payload)
    assert response.status_code == 400
    assert "Invalid mode" in response.json()["detail"]


def test_allocate_invalid_vehicle():
    payload = {"mode": "static", "rolling_horizon_steps": 1, "vehicle_type": "car"}
    response = client.post("/allocate", json=payload)
    assert response.status_code == 400
    assert "Invalid vehicle_type" in response.json()["detail"]
