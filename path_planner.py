import heapq
from typing import List, Tuple, Dict, Set, Optional

class AStarPathPlanner:
    def __init__(self, grid: List[List[int]], start: Tuple[int, int], goal: Tuple[int, int]):
        """
        A* path planner for grid-based maps.
        Grid: 0 = free, 1 = obstacle, 2 = risk area (higher cost).
        """
        self.grid = grid
        self.rows = len(grid)
        self.cols = len(grid[0]) if grid else 0
        self.start = start
        self.goal = goal

    def heuristic(self, a: Tuple[int, int], b: Tuple[int, int]) -> float:
        return abs(a[0] - b[0]) + abs(a[1] - b[1])  # Manhattan distance

    def get_neighbors(self, node: Tuple[int, int]) -> List[Tuple[int, int]]:
        directions = [(-1, 0), (1, 0), (0, -1), (0, 1), (-1, -1), (-1, 1), (1, -1), (1, 1)]
        neighbors = []
        for dx, dy in directions:
            nx, ny = node[0] + dx, node[1] + dy
            if 0 <= nx < self.rows and 0 <= ny < self.cols and self.grid[nx][ny] != 1:
                neighbors.append((nx, ny))
        return neighbors

    def plan_path(self) -> Optional[List[Tuple[int, int]]]:
        open_set = []
        heapq.heappush(open_set, (0, self.start))
        came_from: Dict[Tuple[int, int], Optional[Tuple[int, int]]] = {self.start: None}
        g_score: Dict[Tuple[int, int], float] = {self.start: 0}
        f_score: Dict[Tuple[int, int], float] = {self.start: self.heuristic(self.start, self.goal)}

        while open_set:
            _, current = heapq.heappop(open_set)

            if current == self.goal:
                path = []
                while current:
                    path.append(current)
                    current = came_from[current]
                path.reverse()
                return path

            for neighbor in self.get_neighbors(current):
                # Cost: 1 for free, 2 for risk
                cost = 1 if self.grid[neighbor[0]][neighbor[1]] == 0 else 2
                tentative_g = g_score[current] + cost

                if neighbor not in g_score or tentative_g < g_score[neighbor]:
                    came_from[neighbor] = current
                    g_score[neighbor] = tentative_g
                    f_score[neighbor] = tentative_g + self.heuristic(neighbor, self.goal)
                    heapq.heappush(open_set, (f_score[neighbor], neighbor))

        return None  # No path found

    def compute_distance(self, path: List[Tuple[int, int]]) -> float:
        if not path:
            return float('inf')
        distance = 0
        for i in range(1, len(path)):
            dx = abs(path[i][0] - path[i-1][0])
            dy = abs(path[i][1] - path[i-1][1])
            distance += 1.414 if dx and dy else 1  # Diagonal or straight
        return distance

    def compute_risk(self, path: List[Tuple[int, int]]) -> float:
        risk = 0
        for cell in path:
            if self.grid[cell[0]][cell[1]] == 2:
                risk += 1
        return risk / len(path) if path else 0