addEventListener("fetch", (event) => {
  event.passThroughOnException();
  event.respondWith(handleRequest(event.request));
});

const routes = {
  "docker.dk.300111.xyz": "https://registry-1.docker.io",
  "quay.dk.300111.xyz": "https://quay.io",
  "gcr.dk.300111.xyz": "https://gcr.io",
  // 添加你的自定义主机名和对应的 Docker 注册中心地址
  "mydockerregistry.dk.300111.xyz": "https://your-custom-docker-registry.com",
};

function routeByHosts(host) {
  if (host in routes) {
    return routes[host];
  }
  // 如果需要，可以根据需要修改调试模式和目标上游地址
  // 注意: MODE 和 TARGET_UPSTREAM 变量需要你自己定义和初始化
  // 示例中的 "debug" 和 "TARGET_UPSTREAM" 只是占位符，请根据你的实际需求进行修改
  if (MODE == "debug") {
    return TARGET_UPSTREAM;
  }
  return "";
}


async function handleRequest(request) {
  const url = new URL(request.url);
  const upstream = routeByHosts(url.hostname);
  if (upstream === "") {
    return new Response(
      JSON.stringify({
        routes: routes,
      }),
      {
        status: 404,
      }
    );
  }
  // check if need to authenticate
  if (url.pathname == "/v2/") {
    const newUrl = new URL(upstream + "/v2/");
    const resp = await fetch(newUrl.toString(), {
      method: "GET",
      redirect: "follow",
    });
    if (resp.status === 200) {
    } else if (resp.status === 401) {
      const headers = new Headers();
      if (MODE == "debug") {
        headers.set(
          "Www-Authenticate",
          `Bearer realm="${LOCAL_ADDRESS}/v2/auth",service="cloudflare-docker-proxy"`
        );
      } else {
        headers.set(
          "Www-Authenticate",
          `Bearer realm="https://${url.hostname}/v2/auth",service="cloudflare-docker-proxy"`
        );
      }
      return new Response(JSON.stringify({ message: "UNAUTHORIZED" }), {
        status: 401,
        headers: headers,
      });
    } else {
      return resp;
    }
  }
  // get token
  if (url.pathname == "/v2/auth") {
    const newUrl = new URL(upstream + "/v2/");
    const resp = await fetch(newUrl.toString(), {
      method: "GET",
      redirect: "follow",
    });
    if (resp.status !== 401) {
      return resp;
    }
    const authenticateStr = resp.headers.get("WWW-Authenticate");
    if (authenticateStr === null) {
      return resp;
    }
    const wwwAuthenticate = parseAuthenticate(authenticateStr);
    return await fetchToken(wwwAuthenticate, url.searchParams);
  }
  // foward requests
  const newUrl = new URL(upstream + url.pathname);
  const newReq = new Request(newUrl, {
    method: request.method,
    headers: request.headers,
    redirect: "follow",
  });
  return await fetch(newReq);
}

function parseAuthenticate(authenticateStr) {
  // sample: Bearer realm="https://auth.ipv6.docker.com/token",service="registry.docker.io"
  // match strings after =" and before "
  const re = /(?<=\=")(?:\\.|[^"\\])*(?=")/g;
  const matches = authenticateStr.match(re);
  if (matches === null || matches.length < 2) {
    throw new Error(`invalid Www-Authenticate Header: ${authenticateStr}`);
  }
  return {
    realm: matches[0],
    service: matches[1],
  };
}

async function fetchToken(wwwAuthenticate, searchParams) {
  const url = new URL(wwwAuthenticate.realm);
  if (wwwAuthenticate.service.length) {
    url.searchParams.set("service", wwwAuthenticate.service);
  }
  if (searchParams.get("scope")) {
    url.searchParams.set("scope", searchParams.get("scope"));
  }
  return await fetch(url, { method: "GET", headers: {} });
}
