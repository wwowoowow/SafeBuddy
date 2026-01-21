import dijkstra from 'dijkstrajs'; 

const ODSAY_API_KEY = process.env.REACT_APP_ODSAY_API_KEY;

// =========================================================
// 1. 그래프 생성 (단순 구조만 생성, 비용 계산은 나중에)
// =========================================================
export const buildGraph = (geoData) => {
  const graph = {}; 
  const features = Array.isArray(geoData) ? geoData : (geoData.features || []);

  features.forEach(feature => {
    const props = feature.properties;

    // 노드 ID (좌표 대신 ID 사용 -> 훨씬 빠르고 정확함)
    const u = props.F_NODE ? String(props.F_NODE) : `n_${props.link_id}_s`; 
    const v = props.T_NODE ? String(props.T_NODE) : `n_${props.link_id}_e`;
    
    // 데이터 추출
    const len = props.LENGTH || 100;
    const width = props.width || props.road_width || 6;
    const cctv = props.cctv_cnt || 0;
    const lamp = props.lamp_cnt || 0;

    // 📝 [단순 규칙] 사각지대 점수 미리 계산
    let blindScore = 0;
    if (cctv === 0) blindScore += 20;   // CCTV 없으면 위험
    if (lamp === 0) blindScore += 10;   // 가로등 없으면 위험
    if (width < 4) blindScore += 20;    // 좁으면 위험
    if (width >= 12) blindScore = 0;    // 큰 길은 안전

    const edgeData = {
      id: props.link_id,
      len: len,
      cctv: cctv,
      lamp: lamp,
      width: width,
      blind: props.blind_score || blindScore, 
      geometry: feature.geometry.coordinates 
    };

    if (!graph[u]) graph[u] = {};
    if (!graph[v]) graph[v] = {};

    graph[u][v] = edgeData;
    graph[v][u] = edgeData; 
  });

  return graph;
};

// =========================================================
// 2. 안심 경로 탐색 (좌표 매칭 기능 추가됨 ✨)
// =========================================================
export const findSafePath = (startStr, endStr, graph, weights) => {
  if (!graph) return [];

  // 1. 입력받은 문자열 좌표("경도,위도")를 숫자로 변환
  const [startLng, startLat] = startStr.split(',').map(Number);
  const [endLng, endLat] = endStr.split(',').map(Number);

  // 2. 가장 가까운 노드 찾기 함수 (Nearest Neighbor Search)
  const findNearestNode = (targetLat, targetLng) => {
    let nearestNode = null;
    let minDistance = Infinity;

    // 그래프의 모든 노드를 뒤져서 가장 가까운 놈을 찾음
    Object.keys(graph).forEach((u) => {
      // 해당 노드(u)와 연결된 첫 번째 엣지를 가져와서 좌표 확인
      const neighbors = graph[u];
      const neighborKeys = Object.keys(neighbors);
      if (neighborKeys.length === 0) return;

      const edge = neighbors[neighborKeys[0]];
      
      // 엣지의 양 끝점 중 하나가 이 노드의 위치임
      // (단순화를 위해 geometry의 첫 점과 끝 점을 비교)
      const points = edge.geometry; // [[lng, lat], [lng, lat]...]
      if (!points || points.length === 0) return;

      // 시작점(points[0])과 끝점(points[last]) 중 현재 노드 u와 가까운 것 선택
      // (정확히 하려면 노드별 좌표 매핑 테이블이 있어야 하지만, 여기선 엣지 정보로 추정)
      // *Tip: GeoJSON 특성상 F_NODE는 geometry[0], T_NODE는 geometry[last]인 경우가 많음.
      
      // 여기서는 단순히 "엣지의 모든 점"과 비교해서 가장 가까운 거리 찾기 (오차 최소화)
      points.forEach(pt => {
        const [lng, lat] = pt;
        // 피타고라스 거리 계산 (정확한 미터법은 아니지만 비교용으론 충분)
        const dist = Math.sqrt(Math.pow(lat - targetLat, 2) + Math.pow(lng - targetLng, 2));
        
        if (dist < minDistance) {
          minDistance = dist;
          nearestNode = u;
        }
      });
    });

    return nearestNode;
  };

  // 3. 실제 출발/도착 노드 찾기
  // (그래프가 너무 크면 여기서 약간 렉이 걸릴 수 있음 -> 나중에 최적화 가능)
  const startNode = findNearestNode(startLat, startLng);
  const endNode = findNearestNode(endLat, endLng);

  if (!startNode || !endNode) {
    console.warn("❌ 근처 도로를 찾을 수 없습니다.");
    return [];
  }

  // 4. 비용(Cost) 계산 및 다익스트라 실행
  const getCost = (u, v) => {
    const edge = graph[u][v];
    if (!edge) return 999999;

    let cost = edge.len; 
    
    // 가중치 적용 (안심 vs 최단)
    cost -= (edge.cctv * weights.cctv * 5); 
    cost -= (edge.lamp * weights.light * 2); 
    cost += (edge.blind * weights.blind * 10); 

    return Math.max(1, cost); 
  };

  try {
    const costGraph = {};
    for (const u in graph) {
      costGraph[u] = {};
      for (const v in graph[u]) {
        costGraph[u][v] = getCost(u, v);
      }
    }

    // 라이브러리로 최단 경로 추출
    const pathNodes = dijkstra.find_path(costGraph, startNode, endNode);
    
    // 노드 -> 좌표 변환
    const pathCoords = [];
    for (let i = 0; i < pathNodes.length - 1; i++) {
      const u = pathNodes[i];
      const v = pathNodes[i+1];
      const edge = graph[u][v];
      if (edge && edge.geometry) {
        // 엣지의 방향이 (u->v)인지 (v->u)인지 확인해서 좌표 순서 맞추기
        // (단순화를 위해 그냥 geometry 그대로 넣음)
        edge.geometry.forEach(pt => pathCoords.push({ lat: pt[1], lng: pt[0] }));
      }
    }
    return pathCoords;

  } catch (e) {
    console.error("길찾기 실패 (연결되지 않은 도로일 수 있음):", e);
    // 실패 시 직선이라도 그어주기 위해 빈 배열 대신 null 반환 가능하지만, 일단 빈 배열
    return [];
  }
};

// =========================================================
// 3. ODsay API
// =========================================================
export const fetchTransitRoute = async (sx, sy, ex, ey) => {
  try {
    // API 키 없어도 테스트 가능하게 처리
    const apiKey = process.env.REACT_APP_ODSAY_API_KEY;
    if (!apiKey) throw new Error("API Key 없음");

    const url = `https://api.odsay.com/v1/api/searchPubTransPathT?SX=${sx}&SY=${sy}&EX=${ex}&EY=${ey}&apiKey=${encodeURIComponent(apiKey)}`;
    const response = await fetch(url);
    const data = await response.json();
    
    if (data.result) return data.result;
    else throw new Error("결과 없음");
  } catch (error) {
    console.warn("ODsay 에러 (더미 경로 반환):", error);
    return {
      path: [{
        pathType: 1,
        info: { totalTime: 15, totalDistance: 500, payment: 0 },
        subPath: [
          { trafficType: 3, sectionTime: 15, startX: sx, startY: sy, endX: ex, endY: ey }
        ]
      }]
    };
  }
};