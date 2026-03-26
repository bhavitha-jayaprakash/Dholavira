from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
from typing import List, Dict, Optional, Any

from disaster_alloc import (
    build_default_graph,
    create_default_scenarios,
    DisasterResourceAllocator,
    DynamicGraph,
    Scenario,
)

app = FastAPI(title="Disaster Resource Allocation API",
              description="API for hybrid stochastic+robust disaster resource allocation",
              version="1.0.0")


class HITLOverrides(BaseModel):
    weights: Optional[Dict[str, float]] = None
    force_node: Optional[Dict[str, bool]] = None
    force_route: Optional[Dict[str, bool]] = None


class RunRequest(BaseModel):
    mode: str = Field("static", description="static or rolling")
    rolling_horizon_steps: int = Field(1, ge=1, description="steps for rolling horizon")
    vehicle_type: str = Field("truck", description="truck|bike|drone")
    hitl: Optional[HITLOverrides] = None


class AllocationResponse(BaseModel):
    flows: List[Dict[str, Any]]
    active_nodes: List[str]
    critical_routes: List[str]
    unmet_demand: List[Dict[str, Any]]
    explanations: List[Dict[str, Any]]
    robust_margin: Dict[str, float]


@app.get("/health", tags=["Health"])
def health() -> Dict[str, str]:
    return {"status": "ok", "message": "Disaster Allocation backend is running"}


@app.post("/allocate", response_model=AllocationResponse, tags=["Allocation"])
def allocate(request: RunRequest) -> AllocationResponse:
    if request.mode not in ("static", "rolling"):
        raise HTTPException(status_code=400, detail="Invalid mode: choose 'static' or 'rolling'")

    if request.vehicle_type not in ("truck", "bike", "drone"):
        raise HTTPException(status_code=400, detail="Invalid vehicle_type: choose 'truck', 'bike', or 'drone'")

    try:
        graph: DynamicGraph = build_default_graph()
        scenarios: List[Scenario] = create_default_scenarios()
        allocator = DisasterResourceAllocator(graph)

        hitl_overrides = None
        if request.hitl:
            hitl_overrides = {
                "weights": request.hitl.weights,
                "force_node": request.hitl.force_node,
                "force_route": request.hitl.force_route,
            }

        result = allocator.run(
            scenarios=scenarios,
            mode=request.mode,
            rolling_horizon_steps=request.rolling_horizon_steps,
            hitl_overrides=hitl_overrides,
            vehicle_type=request.vehicle_type,
        )

        return AllocationResponse(**result)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Allocation error: {str(e)}")
