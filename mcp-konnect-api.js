import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import axios from "axios";

/**
 * Kong API Regions - Different geographical API endpoints 
 * that can be used based on your organization's location
 */
const API_REGIONS = {
  US: "us.api.konghq.com",
  EU: "eu.api.konghq.com",
  AU: "au.api.konghq.com",
  ME: "me.api.konghq.com",
  IN: "in.api.konghq.com",
};

// Default to US region if not specified
const API_REGION = process.env.KONNECT_API_REGION || API_REGIONS.US;
const BASE_URL = `https://${API_REGION}/v2`;
const API_KEY = process.env.KONNECT_API_KEY || "";

if (!API_KEY) {
  console.error("Warning: KONG_API_KEY not set in environment. API calls will fail.");
}

/**
 * Makes authenticated requests to Kong APIs with consistent error handling
 * 
 * @param {string} endpoint - API endpoint to call (with leading slash)
 * @param {string} method - HTTP method (GET, POST, etc.)
 * @param {object|null} data - Optional request body data
 * @returns {Promise<object>} - Response data from the API
 * @throws {Error} - Throws formatted error messages for different error scenarios
 */
async function kongRequest(endpoint, method = "GET", data = null) {
  try {
    const url = `${BASE_URL}${endpoint}`;
    console.error(`Making request to: ${url}`);

    const headers = {
      "Authorization": `Bearer ${API_KEY}`,
      "Content-Type": "application/json",
      "Accept": "application/json"
    };

    const config = {
      method,
      url,
      headers,
      data: data ? JSON.stringify(data) : undefined,
    };

    const response = await axios(config);
    console.error(`Received response with status: ${response.status}`);
    return response.data;
  } catch (error) {
    console.error("API request error:", error.message);

    if (error.response) {
      // The request was made and the server responded with a status code
      // that falls out of the range of 2xx
      const errorData = error.response.data;
      let errorMessage = `API Error (Status ${error.response.status})`;

      if (typeof errorData === 'object') {
        // Extract specific error details when available
        const errorDetails = errorData.message || JSON.stringify(errorData);
        errorMessage += `: ${errorDetails}`;
      } else if (typeof errorData === 'string') {
        errorMessage += `: ${errorData.substring(0, 200)}`;  // Limit string length
      }

      throw new Error(errorMessage);
    } else if (error.request) {
      // The request was made but no response was received
      throw new Error("Network Error: No response received from Kong API. Please check your network connection and API endpoint configuration.");
    } else {
      // Something happened in setting up the request that triggered an Error
      throw new Error(`Request Error: ${error.message}. Please check your request parameters and try again.`);
    }
  }
}

// Create server instance with detailed information
const server = new McpServer({
  name: "kong-api-tool",
  version: "1.0.0",
  description: "Tools for managing and analyzing Kong API Gateway configurations and traffic"
});

// =========================
// Common Field Schemas
// =========================

/**
 * Standard time range options used across multiple tools.
 * Consistent naming helps the LLM understand the relationship.
 */
const timeRangeSchema = z.enum(["15M", "1H", "6H", "12H", "24H", "7D"])
  .default("1H")
  .describe("Time range for data retrieval (15M = 15 minutes, 1H = 1 hour, etc.)");

/**
 * Standard pagination size parameter used across multiple tools
 */
const pageSizeSchema = z.number().int()
  .min(1).max(1000)
  .default(100)
  .describe("Number of items to return per page");

/**
 * Standard response time formatter that can be used across tools
 * for consistent response formatting
 */
function formatResponseTimes(data) {
  return {
    latencyMs: {
      total: data.latencies_response_ms,
      gateway: data.latencies_kong_gateway_ms,
      upstream: data.latencies_upstream_ms
    }
  };
}

// =========================
// API Requests Analytics Tools
// =========================

server.tool(
  "query-api-requests",
  `Query and analyze Kong API Gateway requests with customizable filters. 
   Before calling this it's necessary to have a controlPlaneID and a serviceID or routeID. 
   These can be obtained using the get-control-planes, list-services, and list-routes tools.

INPUT:
  - timeRange: String - Time range for data retrieval (15M, 1H, 6H, 12H, 24H, 7D)
  - statusCodes: Number[] (optional) - Filter by specific HTTP status codes
  - excludeStatusCodes: Number[] (optional) - Exclude specific HTTP status codes
  - httpMethods: String[] (optional) - Filter by HTTP methods (e.g., GET, POST)
  - consumerIds: String[] (optional) - Filter by consumer IDs
  - serviceIds: String[] (optional) - Filter by service IDs. The format of this field must be "<controlPlaneID>:<serviceID>". 
  - routeIds: String[] (optional) - Filter by route IDs. The format of this field must be "<controlPlaneID:routeID>"
  - maxResults: Number - Maximum number of results to return (1-1000)

OUTPUT:
  - metadata: Object - Contains totalRequests, timeRange, and applied filters
  - requests: Array - List of request objects with details including:
    - requestId: String - Unique request identifier
    - timestamp: String - When the request occurred
    - httpMethod: String - HTTP method used (GET, POST, etc.)
    - uri: String - Request URI path
    - statusCode: Number - HTTP status code of the response
    - consumerId: String - ID of the consumer making the request
    - serviceId: String - ID of the service handling the request
    - routeId: String - ID of the matched route
    - latency: Object - Response time metrics:
      - totalMs: Number - Total latency in milliseconds
      - gatewayMs: Number - Time spent in Kong Gateway
      - upstreamMs: Number - Time spent in upstream service
    - clientIp: String - IP address of the client
    - apiProduct: String - API product ID
    - apiProductVersion: String - API product version ID
    - applicationId: String - Application ID
    - authType: String - Authentication type used
    - headers: Object - Request headers:
      - host: String - Host header value
      - userAgent: String - User-Agent header value
    - dataPlane: Object - Data plane information:
      - nodeId: String - Data plane node ID
      - version: String - Data plane version
    - controlPlane: Object - Control plane information:
      - id: String - Control plane ID
      - group: String - Control plane group ID
    - rateLimiting: Object - Rate limiting information:
      - enabled: Boolean - Whether rate limiting is enabled
      - limit: Number - Overall rate limit
      - remaining: Number - Remaining requests allowed
      - reset: Number - Time until limit resets
      - byTimeUnit: Object - Time-based rate limits:
        - second/minute/hour/day/month/year: Objects with enabled, limit, remaining
    - service: Object - Service information:
      - port: String - Service port
      - protocol: String - Service protocol (http, https)
    - requestBodySize: Number - Size of request body in bytes
    - responseBodySize: Number - Size of response body in bytes
    - responseHeaders: Object - Response headers:
      - contentType: String - Content-Type header value
      - contentLength: String - Content-Length header value
    - traceId: String - Distributed tracing ID
    - upstreamUri: String - URI sent to the upstream service
    - upstreamStatus: String - Status code from upstream service
    - recommendations: Array - Suggested next actions and related tools`,
  {
    timeRange: timeRangeSchema,
    statusCodes: z.array(z.number().int().min(100).max(599))
      .optional()
      .describe("Filter by specific HTTP status codes (e.g. [200, 201, 404])"),
    excludeStatusCodes: z.array(z.number().int().min(100).max(599))
      .optional()
      .describe("Exclude specific HTTP status codes (e.g. [400, 401, 500])"),
    httpMethods: z.array(z.string())
      .optional()
      .describe("Filter by HTTP methods (e.g. ['GET', 'POST', 'DELETE'])"),
    consumerIds: z.array(z.string())
      .optional()
      .describe("Filter by consumer IDs"),
    serviceIds: z.array(z.string())
      .optional()
      .describe("Filter by service IDs"),
    routeIds: z.array(z.string())
      .optional()
      .describe("Filter by route IDs (from list-routes tool)"),
    maxResults: pageSizeSchema,
  },
  async ({ timeRange, statusCodes, excludeStatusCodes, httpMethods, consumerIds, serviceIds, routeIds, maxResults }) => {
    try {
      // Build filters array
      const filters = [];

      // Add status code filters
      if (statusCodes && statusCodes.length > 0) {
        filters.push({
          field: "status_code",
          operator: "in",
          value: statusCodes
        });
      }

      if (excludeStatusCodes && excludeStatusCodes.length > 0) {
        filters.push({
          field: "status_code",
          operator: "not_in",
          value: excludeStatusCodes
        });
      }

      // Add HTTP method filters
      if (httpMethods && httpMethods.length > 0) {
        filters.push({
          field: "http_method",
          operator: "in",
          value: httpMethods
        });
      }

      // Add consumer filters
      if (consumerIds && consumerIds.length > 0) {
        filters.push({
          field: "consumer",
          operator: "in",
          value: consumerIds
        });
      }

      // Add service filters
      if (serviceIds && serviceIds.length > 0) {
        filters.push({
          field: "gateway_service",
          operator: "in",
          value: serviceIds
        });
      }

      // Add route filters
      if (routeIds && routeIds.length > 0) {
        filters.push({
          field: "route",
          operator: "in",
          value: routeIds
        });
      }

      // Create request body
      const requestBody = {
        time_range: {
          type: "relative",
          time_range: timeRange
        },
        filters: filters,
        size: maxResults
      };

      // Make the API request
      const result = await kongRequest("/api-requests", "POST", requestBody);

      // Format the response with a consistent structure
      const formattedResponse = {
        metadata: {
          totalRequests: result.meta.size,
          timeRange: {
            start: result.meta.time_range.start,
            end: result.meta.time_range.end,
          },
          filters: filters
        },
        requests: result.results.map(req => ({
          requestId: req.request_id,
          timestamp: req.request_start,
          httpMethod: req.http_method,
          uri: req.request_uri,
          statusCode: req.status_code || req.response_http_status,
          consumerId: req.consumer,
          serviceId: req.gateway_service,
          routeId: req.route,
          latency: {
            totalMs: req.latencies_response_ms,
            gatewayMs: req.latencies_kong_gateway_ms,
            upstreamMs: req.latencies_upstream_ms
          },
          clientIp: req.client_ip,
          apiProduct: req.api_product,
          apiProductVersion: req.api_product_version,
          applicationId: req.application,
          authType: req.auth_type,
          headers: {
            host: req.header_host,
            userAgent: req.header_user_agent
          },
          dataPlane: {
            nodeId: req.data_plane_node,
            version: req.data_plane_node_version
          },
          controlPlane: {
            id: req.control_plane,
            group: req.control_plane_group
          },
          rateLimiting: {
            enabled: req.ratelimit_enabled,
            limit: req.ratelimit_limit,
            remaining: req.ratelimit_remaining,
            reset: req.ratelimit_reset,
            byTimeUnit: {
              second: {
                enabled: req.ratelimit_enabled_second,
                limit: req.ratelimit_limit_second,
                remaining: req.ratelimit_remaining_second
              },
              minute: {
                enabled: req.ratelimit_enabled_minute,
                limit: req.ratelimit_limit_minute,
                remaining: req.ratelimit_remaining_minute
              },
              hour: {
                enabled: req.ratelimit_enabled_hour,
                limit: req.ratelimit_limit_hour,
                remaining: req.ratelimit_remaining_hour
              },
              day: {
                enabled: req.ratelimit_enabled_day,
                limit: req.ratelimit_limit_day,
                remaining: req.ratelimit_remaining_day
              },
              month: {
                enabled: req.ratelimit_enabled_month,
                limit: req.ratelimit_limit_month,
                remaining: req.ratelimit_remaining_month
              },
              year: {
                enabled: req.ratelimit_enabled_year,
                limit: req.ratelimit_limit_year,
                remaining: req.ratelimit_remaining_year
              }
            }
          },
          service: {
            port: req.service_port,
            protocol: req.service_protocol
          },
          requestBodySize: req.request_body_size,
          responseBodySize: req.response_body_size,
          responseHeaders: {
            contentType: req.response_header_content_type,
            contentLength: req.response_header_content_length
          },
          traceId: req.trace_id,
          upstreamUri: req.upstream_uri,
          upstreamStatus: req.upstream_status,
          recommendations: [
            "Use 'get-consumer-requests' tool with consumerId from top failing consumers for more details",
            "Check 'query-api-requests' with specific status codes for deeper investigation"
          ]
        }))
      };

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(formattedResponse, null, 2)
          }
        ]
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error querying API requests: ${error.message}\n\nTroubleshooting tips:\n1. Verify your API key is valid and has sufficient permissions\n2. Check that the time range and filter values are valid\n3. Ensure your network connection to the Kong API is working properly`
          }
        ],
        isError: true
      };
    }
  }
);

server.tool(
  "get-consumer-requests",
  `Retrieve and analyze API requests made by a specific consumer.

INPUT:
  - consumerId: String - ID of the consumer to analyze. The format of this field must be "controlPlaneID:consumerId".
  - timeRange: String - Time range for data retrieval (15M, 1H, 6H, 12H, 24H, 7D)
  - successOnly: Boolean - Filter to only show successful (2xx) requests (default: false)
  - failureOnly: Boolean - Filter to only show failed (non-2xx) requests (default: false)
  - maxResults: Number - Maximum number of results to return (1-1000)

OUTPUT:
  - metadata: Object - Contains consumerId, totalRequests, timeRange, and filters
  - statistics: Object - Usage statistics including:
    - averageLatencyMs: Number - Average response time in milliseconds
    - successRate: Number - Percentage of successful requests
    - statusCodeDistribution: Array - Breakdown of requests by status code
    - serviceDistribution: Array - Breakdown of requests by service
  - requests: Array - List of requests with details for each request`,
  {
    consumerId: z.string()
      .describe("Consumer ID to filter by (obtainable from analyze-failed-requests or query-api-requests tools)"),
    timeRange: timeRangeSchema,
    successOnly: z.boolean()
      .default(false)
      .describe("Show only successful (2xx) requests"),
    failureOnly: z.boolean()
      .default(false)
      .describe("Show only failed (non-2xx) requests"),
    maxResults: pageSizeSchema,
  },
  async ({ consumerId, timeRange, successOnly, failureOnly, maxResults }) => {
    try {
      // Build filters array
      const filters = [
        {
          field: "consumer",
          operator: "in",
          value: consumerId
        }
      ];

      // Add status code filter if needed
      if (successOnly) {
        filters.push({
          field: "status_code_grouped",
          operator: "in",
          value: ["2XX"]
        });
      } else if (failureOnly) {
        filters.push({
          field: "status_code_grouped",
          operator: "in",
          value: ["4XX", "5XX"]
        });
      }

      // Create request body
      const requestBody = {
        time_range: {
          type: "relative",
          time_range: timeRange
        },
        filters: filters,
        size: maxResults
      };

      // Make the API request
      const result = await kongRequest("/api-requests", "POST", requestBody);
      
      // Calculate some statistics if we have results
      let avgLatency = 0;
      let successRate = 0;
      let statusCodeCounts = {};
      let serviceBreakdown = {};
      
      if (result.results.length > 0) {
        // Calculate average latency
        avgLatency = result.results.reduce((sum, req) => sum + (req.latencies_response_ms || 0), 0) / result.results.length;
        
        // Calculate success rate
        const successCount = result.results.filter(req => {
          const status = req.status_code || req.response_http_status;
          return status >= 200 && status < 300;
        }).length;
        successRate = (successCount / result.results.length) * 100;
        
        // Count status codes
        result.results.forEach(req => {
          const status = req.status_code || req.response_http_status;
          statusCodeCounts[status] = (statusCodeCounts[status] || 0) + 1;
        });
        
        // Service breakdown
        result.results.forEach(req => {
          const service = req.gateway_service || "unknown";
          if (!serviceBreakdown[service]) {
            serviceBreakdown[service] = { count: 0, statusCodes: {} };
          }
          serviceBreakdown[service].count++;
          
          const status = req.status_code || req.response_http_status;
          serviceBreakdown[service].statusCodes[status] = (serviceBreakdown[service].statusCodes[status] || 0) + 1;
        });
      }

      // Format the response in a readable way
      const formattedResponse = {
        metadata: {
          consumerId: consumerId,
          totalRequests: result.results.length,
          timeRange: {
            start: result.meta.time_range.start,
            end: result.meta.time_range.end,
          },
          filters: {
            successOnly,
            failureOnly
          }
        },
        statistics: {
          averageLatencyMs: parseFloat(avgLatency.toFixed(2)),
          successRate: parseFloat(successRate.toFixed(2)),
          statusCodeDistribution: Object.entries(statusCodeCounts).map(([code, count]) => ({
            statusCode: parseInt(code),
            count: count,
            percentage: parseFloat(((count / result.results.length) * 100).toFixed(2))
          })).sort((a, b) => b.count - a.count),
          serviceDistribution: Object.entries(serviceBreakdown).map(([service, data]) => ({
            serviceId: service,
            count: data.count,
            percentage: parseFloat(((data.count / result.results.length) * 100).toFixed(2)),
            statusCodeBreakdown: Object.entries(data.statusCodes).map(([code, count]) => ({
              statusCode: parseInt(code),
              count: count
            })).sort((a, b) => b.count - a.count)
          })).sort((a, b) => b.count - a.count)
        },
        requests: result.results.map(req => ({
          timestamp: req.request_start,
          httpMethod: req.http_method,
          uri: req.request_uri,
          statusCode: req.status_code || req.response_http_status,
          serviceId: req.gateway_service,
          routeId: req.route,
          latency: {
            totalMs: req.latencies_response_ms,
            gatewayMs: req.latencies_kong_gateway_ms,
            upstreamMs: req.latencies_upstream_ms
          },
          clientIp: req.client_ip,
          traceId: req.trace_id
        }))
      };

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(formattedResponse, null, 2)
          }
        ]
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error fetching consumer requests: ${error.message}\n\nTroubleshooting tips:\n1. Verify the consumerId is valid and exists in your Kong environment\n2. Check that the consumer has made requests within the specified time range\n3. Ensure you're not using both successOnly and failureOnly parameters together`
          }
        ],
        isError: true
      };
    }
  }
);

// =========================
// Control Planes Configuration Tools
// =========================

server.tool(
  "list-services",
  `List all services associated with a control plane.

INPUT:
  - controlPlaneId: String - ID of the control plane
  - size: Number - Number of services to return (1-1000, default: 100)
  - offset: String (optional) - Pagination offset token from previous response

OUTPUT:
  - metadata: Object - Contains controlPlaneId, size, offset, nextOffset, totalCount
  - services: Array - List of services with details for each including:
    - serviceId: String - Unique identifier for the service
    - name: String - Display name of the service
    - host: String - Target host for the service
    - port: Number - Target port for the service
    - protocol: String - Protocol used (http, https, grpc, etc.)
    - path: String - Path prefix for the service
    - retries: Number - Number of retries on failure
    - connectTimeout: Number - Connection timeout in milliseconds
    - writeTimeout: Number - Write timeout in milliseconds
    - readTimeout: Number - Read timeout in milliseconds
    - tags: Array - Tags associated with the service
    - enabled: Boolean - Whether the service is enabled
    - metadata: Object - Creation and update timestamps
  - relatedTools: Array - List of related tools for further analysis`,
  {
    controlPlaneId: z.string()
      .describe("Control Plane ID (obtainable from list-control-planes tool)"),
    size: z.number().int()
      .min(1).max(1000)
      .default(100)
      .describe("Number of services to return"),
    offset: z.string()
      .optional()
      .describe("Offset token for pagination (from previous response)"),
  },
  async ({ controlPlaneId, size, offset }) => {
    try {
      let endpoint = `/control-planes/${controlPlaneId}/core-entities/services?size=${size}`;
      if (offset) {
        endpoint += `&offset=${offset}`;
      }

      const result = await kongRequest(endpoint);

      // Transform the response to have consistent field names
      const formattedResponse = {
        metadata: {
          controlPlaneId: controlPlaneId,
          size: size,
          offset: offset || null,
          nextOffset: result.offset,
          totalCount: result.total
        },
        services: result.data.map(service => ({
          serviceId: service.id,
          name: service.name,
          host: service.host,
          port: service.port,
          protocol: service.protocol,
          path: service.path,
          retries: service.retries,
          connectTimeout: service.connect_timeout,
          writeTimeout: service.write_timeout,
          readTimeout: service.read_timeout,
          tags: service.tags,
          clientCertificate: service.client_certificate,
          tlsVerify: service.tls_verify,
          tlsVerifyDepth: service.tls_verify_depth,
          caCertificates: service.ca_certificates,
          enabled: service.enabled,
          metadata: {
            createdAt: service.created_at,
            updatedAt: service.updated_at
          }
        })),
        relatedTools: [
          "Use list-routes to find routes that point to these services",
          "Use list-plugins to see plugins configured for these services"
        ]
      };

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(formattedResponse, null, 2)
          }
        ]
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error listing services: ${error.message}\n\nTroubleshooting tips:\n1. Verify that the controlPlaneId is valid\n2. Check that your API key has permission to access this control plane\n3. If pagination is used, verify that the offset value is correct`
          }
        ],
        isError: true
      };
    }
  }
);

server.tool(
  "list-routes",
  `List all routes associated with a control plane.

INPUT:
  - controlPlaneId: String - ID of the control plane
  - size: Number - Number of routes to return (1-1000, default: 100)
  - offset: String (optional) - Pagination offset token from previous response

OUTPUT:
  - metadata: Object - Contains controlPlaneId, size, offset, nextOffset, totalCount
  - routes: Array - List of routes with details for each including:
    - routeId: String - Unique identifier for the route
    - name: String - Display name of the route
    - protocols: Array - Protocols this route accepts (http, https, grpc, etc.)
    - methods: Array - HTTP methods this route accepts
    - hosts: Array - Hostnames this route matches
    - paths: Array - URL paths this route matches
    - stripPath: Boolean - Whether to strip the matched path prefix
    - preserveHost: Boolean - Whether to preserve the host header
    - serviceId: String - ID of the service this route forwards to
    - enabled: Boolean - Whether the route is enabled
    - metadata: Object - Creation and update timestamps
  - relatedTools: Array - List of related tools for further analysis`,
  {
    controlPlaneId: z.string()
      .describe("Control Plane ID (obtainable from list-control-planes tool)"),
    size: z.number().int()
      .min(1).max(1000)
      .default(100)
      .describe("Number of routes to return"),
    offset: z.string()
      .optional()
      .describe("Offset token for pagination (from previous response)"),
  },
  async ({ controlPlaneId, size, offset }) => {
    try {
      let endpoint = `/control-planes/${controlPlaneId}/core-entities/routes?size=${size}`;
      if (offset) {
        endpoint += `&offset=${offset}`;
      }

      const result = await kongRequest(endpoint);

      // Transform the response to have consistent field names
      const formattedResponse = {
        metadata: {
          controlPlaneId: controlPlaneId,
          size: size,
          offset: offset || null,
          nextOffset: result.offset,
          totalCount: result.total
        },
        routes: result.data.map(route => ({
          routeId: route.id,
          name: route.name,
          protocols: route.protocols,
          methods: route.methods,
          hosts: route.hosts,
          paths: route.paths,
          https_redirect_status_code: route.https_redirect_status_code,
          regex_priority: route.regex_priority,
          stripPath: route.strip_path,
          preserveHost: route.preserve_host,
          requestBuffering: route.request_buffering,
          responseBuffering: route.response_buffering,
          tags: route.tags,
          serviceId: route.service?.id,
          enabled: route.enabled,
          metadata: {
            createdAt: route.created_at,
            updatedAt: route.updated_at
          }
        })),
        relatedTools: [
          "Use query-api-requests with specific routeIds to analyze traffic",
          "Use list-services to find details about the services these routes connect to",
          "Use list-plugins to see plugins configured for these routes"
        ]
      };

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(formattedResponse, null, 2)
          }
        ]
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error listing routes: ${error.message}\n\nTroubleshooting tips:\n1. Verify that the controlPlaneId is valid\n2. Check that your API key has permission to access this control plane\n3. If pagination is used, verify that the offset value is correct`
          }
        ],
        isError: true
      };
    }
  }
);

server.tool(
  "list-consumers",
  `List all consumers associated with a control plane.

INPUT:
  - controlPlaneId: String - ID of the control plane
  - size: Number - Number of consumers to return (1-1000, default: 100)
  - offset: String (optional) - Pagination offset token from previous response

OUTPUT:
  - metadata: Object - Contains controlPlaneId, size, offset, nextOffset, totalCount
  - consumers: Array - List of consumers with details for each including:
    - consumerId: String - Unique identifier for the consumer
    - username: String - Username for this consumer
    - customId: String - Custom identifier for this consumer
    - tags: Array - Tags associated with the consumer
    - enabled: Boolean - Whether the consumer is enabled
    - metadata: Object - Creation and update timestamps
  - relatedTools: Array - List of related tools for consumer analysis`,
  {
    controlPlaneId: z.string()
      .describe("Control Plane ID (obtainable from list-control-planes tool)"),
    size: z.number().int()
      .min(1).max(1000)
      .default(100)
      .describe("Number of consumers to return"),
    offset: z.string()
      .optional()
      .describe("Offset token for pagination (from previous response)"),
  },
  async ({ controlPlaneId, size, offset }) => {
    try {
      let endpoint = `/control-planes/${controlPlaneId}/core-entities/consumers?size=${size}`;
      if (offset) {
        endpoint += `&offset=${offset}`;
      }

      const result = await kongRequest(endpoint);

      // Transform the response to have consistent field names
      const formattedResponse = {
        metadata: {
          controlPlaneId: controlPlaneId,
          size: size,
          offset: offset || null,
          nextOffset: result.offset,
          totalCount: result.total
        },
        consumers: result.data.map(consumer => ({
          consumerId: consumer.id,
          username: consumer.username,
          customId: consumer.custom_id,
          tags: consumer.tags,
          enabled: consumer.enabled,
          metadata: {
            createdAt: consumer.created_at,
            updatedAt: consumer.updated_at
          }
        })),
        relatedTools: [
          "Use get-consumer-requests to analyze traffic for a specific consumer",
          "Use list-plugins to see plugins configured for these consumers",
          "Use analyze-failed-requests to identify consumers with high error rates"
        ]
      };

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(formattedResponse, null, 2)
          }
        ]
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error listing consumers: ${error.message}\n\nTroubleshooting tips:\n1. Verify that the controlPlaneId is valid\n2. Check that your API key has permission to access this control plane\n3. If pagination is used, verify that the offset value is correct`
          }
        ],
        isError: true
      };
    }
  }
);

server.tool(
  "list-plugins",
  `List all plugins associated with a control plane.

INPUT:
  - controlPlaneId: String - ID of the control plane
  - size: Number - Number of plugins to return (1-1000, default: 100)
  - offset: String (optional) - Pagination offset token from previous response

OUTPUT:
  - metadata: Object - Contains controlPlaneId, size, offset, nextOffset, totalCount
  - plugins: Array - List of plugins with details for each including:
    - pluginId: String - Unique identifier for the plugin
    - name: String - Name of the plugin (e.g., rate-limiting, cors, etc.)
    - enabled: Boolean - Whether the plugin is enabled
    - config: Object - Plugin-specific configuration
    - protocols: Array - Protocols this plugin applies to
    - tags: Array - Tags associated with the plugin
    - scoping: Object - Defines plugin scope including:
      - consumerId: String - Consumer this plugin applies to (if any)
      - serviceId: String - Service this plugin applies to (if any)
      - routeId: String - Route this plugin applies to (if any)
      - global: Boolean - Whether this is a global plugin
    - metadata: Object - Creation and update timestamps
  - relatedTools: Array - List of related tools for plugin configuration`,
  {
    controlPlaneId: z.string()
      .describe("Control Plane ID (obtainable from list-control-planes tool)"),
    size: z.number().int()
      .min(1).max(1000)
      .default(100)
      .describe("Number of plugins to return"),
    offset: z.string()
      .optional()
      .describe("Offset token for pagination (from previous response)"),
  },
  async ({ controlPlaneId, size, offset }) => {
    try {
      let endpoint = `/control-planes/${controlPlaneId}/core-entities/plugins?size=${size}`;
      if (offset) {
        endpoint += `&offset=${offset}`;
      }

      const result = await kongRequest(endpoint);

      // Transform the response to have consistent field names
      const formattedResponse = {
        metadata: {
          controlPlaneId: controlPlaneId,
          size: size,
          offset: offset || null,
          nextOffset: result.offset,
          totalCount: result.total
        },
        plugins: result.data.map(plugin => ({
          pluginId: plugin.id,
          name: plugin.name,
          enabled: plugin.enabled,
          config: plugin.config,
          protocols: plugin.protocols,
          tags: plugin.tags,
          scoping: {
            consumerId: plugin.consumer?.id,
            serviceId: plugin.service?.id,
            routeId: plugin.route?.id,
            global: (!plugin.consumer && !plugin.service && !plugin.route)
          },
          metadata: {
            createdAt: plugin.created_at,
            updatedAt: plugin.updated_at
          }
        })),
        relatedTools: [
          "Use get-plugin-schema to see detailed configuration options for specific plugin types",
          "Use list-services and list-routes to find entities these plugins are applied to",
          "Use query-api-requests to analyze traffic affected by these plugins"
        ]
      };

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(formattedResponse, null, 2)
          }
        ]
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error listing plugins: ${error.message}\n\nTroubleshooting tips:\n1. Verify that the controlPlaneId is valid\n2. Check that your API key has permission to access this control plane\n3. If pagination is used, verify that the offset value is correct`
          }
        ],
        isError: true
      };
    }
  }
);


// =========================
// Control Planes Tools
// =========================

server.tool(
  "list-control-planes",
  `List all control planes in your organization.

INPUT:
  - pageSize: Number - Number of control planes per page (1-1000, default: 10)
  - pageNumber: Number (optional) - Page number to retrieve
  - filterName: String (optional) - Filter control planes by name
  - filterClusterType: String (optional) - Filter by cluster type (kubernetes, docker, etc.)
  - filterCloudGateway: Boolean (optional) - Filter by cloud gateway capability
  - labels: String (optional) - Filter by labels (format: 'key:value,existCheck')
  - sort: String (optional) - Sort field and direction (e.g. 'name,created_at desc')

OUTPUT:
  - metadata: Object - Contains pageSize, pageNumber, totalPages, totalCount, filters, sort
  - controlPlanes: Array - List of control planes with details for each including:
    - controlPlaneId: String - Unique identifier for the control plane
    - name: String - Display name of the control plane
    - description: String - Description of the control plane
    - type: String - Type of the control plane
    - clusterType: String - Underlying cluster type
    - controlPlaneEndpoint: String - URL endpoint for the control plane
    - telemetryEndpoint: String - URL endpoint for telemetry
    - hasCloudGateway: Boolean - Whether cloud gateway is enabled
    - labels: Object - Labels assigned to this control plane
    - metadata: Object - Creation and update timestamps
  - usage: Object - Information about how to use these results`,
  {
    pageSize: z.number().int()
      .min(1).max(1000)
      .default(10)
      .describe("Number of control planes to return per page"),
    pageNumber: z.number().int()
      .min(1)
      .optional()
      .describe("Page number to retrieve"),
    filterName: z.string()
      .optional()
      .describe("Filter control planes by name (contains)"),
    filterClusterType: z.string()
      .optional()
      .describe("Filter by cluster type (e.g., 'kubernetes', 'docker')"),
    filterCloudGateway: z.boolean()
      .optional()
      .describe("Filter by cloud gateway capability"),
    labels: z.string()
      .optional()
      .describe("Filter by labels (format: 'key:value,existCheck')"),
    sort: z.string()
      .optional()
      .describe("Sort field and direction (e.g. 'name,created_at desc')"),
  },
  async ({ pageSize, pageNumber, filterName, filterClusterType, filterCloudGateway, labels, sort }) => {
    try {
      let endpoint = `/control-planes?page[size]=${pageSize}`;

      // Add optional query parameters
      if (pageNumber) {
        endpoint += `&page[number]=${pageNumber}`;
      }

      // Add filter parameters individually using the proper filter[field][operator] format
      if (filterName) {
        endpoint += `&filter[name][contains]=${encodeURIComponent(filterName)}`;
      }
      if (filterClusterType) {
        endpoint += `&filter[cluster_type][eq]=${encodeURIComponent(filterClusterType)}`;
      }
      if (filterCloudGateway !== undefined) {
        endpoint += `&filter[cloud_gateway]=${filterCloudGateway}`;
      }

      // Add labels filter if present
      if (labels) {
        endpoint += `&labels=${encodeURIComponent(labels)}`;
      }

      // Add sort parameter if present
      if (sort) {
        endpoint += `&sort=${encodeURIComponent(sort)}`;
      }

      const result = await kongRequest(endpoint);

      // Transform the response to have consistent field names
      const formattedResponse = {
        metadata: {
          pageSize: pageSize,
          pageNumber: pageNumber || 1,
          totalPages: result.meta.page_count,
          totalCount: result.meta.total_count,
          filters: {
            name: filterName || null,
            clusterType: filterClusterType || null,
            cloudGateway: filterCloudGateway !== undefined ? filterCloudGateway : null,
            labels: labels || null
          },
          sort: sort || null
        },
        controlPlanes: result.data.map(cp => ({
          controlPlaneId: cp.id,
          name: cp.name,
          description: cp.description,
          type: cp.type,
          clusterType: cp.cluster_type,
          controlPlaneEndpoint: cp.control_plane_endpoint,
          telemetryEndpoint: cp.telemetry_endpoint,
          hasCloudGateway: cp.has_cloud_gateway,
          labels: cp.labels,
          metadata: {
            createdAt: cp.created_at,
            updatedAt: cp.updated_at
          }
        })),
        usage: {
          instructions: "Use the controlPlaneId from these results with other tools like list-services, list-data-plane-nodes, etc.",
          pagination: "For more results, increment pageNumber or increase pageSize"
        }
      };

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(formattedResponse, null, 2)
          }
        ]
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error listing control planes: ${error.message}\n\nTroubleshooting tips:\n1. Verify your API key has sufficient permissions\n2. Check that filter parameters use supported operators\n3. If pagination is used, verify the page number is valid`
          }
        ],
        isError: true
      };
    }
  }
);

server.tool(
  "get-control-plane",
  `Get detailed information about a specific control plane.

INPUT:
  - controlPlaneId: String - ID of the control plane to retrieve

OUTPUT:
  - controlPlaneDetails: Object - Detailed information including:
    - controlPlaneId: String - Unique identifier for the control plane
    - name: String - Display name of the control plane
    - description: String - Description of the control plane
    - type: String - Type of the control plane
    - clusterType: String - Underlying cluster type
    - controlPlaneEndpoint: String - URL endpoint for the control plane
    - telemetryEndpoint: String - URL endpoint for telemetry
    - hasCloudGateway: Boolean - Whether cloud gateway is enabled
    - labels: Object - Labels assigned to this control plane
    - metadata: Object - Creation and update timestamps
  - relatedTools: Array - List of related tools for further analysis`,
  {
    controlPlaneId: z.string()
      .describe("Control Plane ID (obtainable from list-control-planes tool)"),
  },
  async ({ controlPlaneId }) => {
    try {
      const endpoint = `/control-planes/${controlPlaneId}`;
      const result = await kongRequest(endpoint);

      // Transform the response to have consistent field names
      const cp = result.data;
      const formattedResponse = {
        controlPlaneDetails: {
          controlPlaneId: cp.id,
          name: cp.name,
          description: cp.description,
          type: cp.type,
          clusterType: cp.cluster_type,
          controlPlaneEndpoint: cp.control_plane_endpoint,
          telemetryEndpoint: cp.telemetry_endpoint,
          hasCloudGateway: cp.has_cloud_gateway,
          labels: cp.labels,
          metadata: {
            createdAt: cp.created_at,
            updatedAt: cp.updated_at
          }
        },
        relatedTools: [
          "Use list-data-plane-nodes to see all nodes in this control plane",
          "Use list-services to see services configured in this control plane",
          "Use query-api-requests to analyze traffic for this control plane"
        ]
      };

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(formattedResponse, null, 2)
          }
        ]
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error getting control plane details: ${error.message}\n\nTroubleshooting tips:\n1. Verify that the controlPlaneId is valid\n2. Check that your API key has permission to access this control plane\n3. Use list-control-planes tool first to get valid control plane IDs`
          }
        ],
        isError: true
      };
    }
  }
);

// =========================
// Control Plane Groups Tools
// =========================

server.tool(
  "list-control-plane-group-memberships",
  `List all control planes that are members of a specific control plane group.

INPUT:
  - groupId: String - ID of the control plane group (control plane that acts as the group)
  - pageSize: Number - Number of members to return per page (1-1000, default: 10)
  - pageAfter: String (optional) - Cursor for pagination after a specific item

OUTPUT:
  - metadata: Object - Contains groupId, pageSize, pageAfter, nextPageAfter, totalCount
  - members: Array - List of member control planes with details for each including:
    - controlPlaneId: String - Unique identifier for the control plane
    - name: String - Display name of the control plane
    - description: String - Description of the control plane
    - type: String - Type of the control plane
    - clusterType: String - Underlying cluster type
    - membershipStatus: Object - Group membership status including:
      - status: String - Current status (OK, CONFLICT, etc.)
      - message: String - Status message
      - conflicts: Array - List of configuration conflicts if any
    - metadata: Object - Creation and update timestamps
  - relatedTools: Array - List of related tools for group management`,
  {
    groupId: z.string()
      .describe("Control plane group ID (the ID of the control plane that acts as the group)"),
    pageSize: z.number().int()
      .min(1).max(1000)
      .default(10)
      .describe("Number of members to return per page"),
    pageAfter: z.string()
      .optional()
      .describe("Cursor for pagination after a specific item"),
  },
  async ({ groupId, pageSize, pageAfter }) => {
    try {
      let endpoint = `/control-planes/${groupId}/group-memberships?page[size]=${pageSize}`;

      if (pageAfter) {
        endpoint += `&page[after]=${pageAfter}`;
      }

      const result = await kongRequest(endpoint);

      // Transform the response to have consistent field names
      const formattedResponse = {
        metadata: {
          groupId: groupId,
          pageSize: pageSize,
          pageAfter: pageAfter || null,
          nextPageAfter: result.meta?.next_page?.after || null,
          totalCount: result.meta?.total_count || 0
        },
        members: result.data.map(member => ({
          controlPlaneId: member.id,
          name: member.name,
          description: member.description,
          type: member.type,
          clusterType: member.cluster_type,
          membershipStatus: {
            status: member.cp_group_member_status?.status,
            message: member.cp_group_member_status?.message,
            conflicts: member.cp_group_member_status?.conflicts || []
          },
          metadata: {
            createdAt: member.created_at,
            updatedAt: member.updated_at
          }
        })),
        relatedTools: [
          "Use get-control-plane-group-status to check for configuration conflicts",
          "Use check-control-plane-group-membership to verify if a specific control plane is a member",
          "Use get-control-plane to get more details about a specific member"
        ]
      };

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(formattedResponse, null, 2)
          }
        ]
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error listing control plane group memberships: ${error.message}\n\nTroubleshooting tips:\n1. Verify that the groupId is valid and refers to a control plane that acts as a group\n2. Check that your API key has permission to access this control plane group\n3. If pagination is used, verify that the pageAfter value is correct`
          }
        ],
        isError: true
      };
    }
  }
);

server.tool(
  "check-control-plane-group-membership",
  `Check if a control plane is a member of any group.

INPUT:
  - controlPlaneId: String - ID of the control plane to check

OUTPUT:
  - controlPlaneId: String - ID of the control plane that was checked
  - groupMembership: Object - Membership information including:
    - isMember: Boolean - Whether the control plane is a member of any group
    - groupId: String - ID of the group this control plane belongs to (if any)
    - groupName: String - Name of the group this control plane belongs to
    - status: String - Membership status (OK, CONFLICT, etc.)
    - message: String - Status message
    - conflicts: Array - List of configuration conflicts if any
  - relatedTools: Array - List of related tools for group management`,
  {
    controlPlaneId: z.string()
      .describe("Control plane ID to check (can be obtained from list-control-planes tool)"),
  },
  async ({ controlPlaneId }) => {
    try {
      const endpoint = `/control-planes/${controlPlaneId}/group-member-status`;
      const result = await kongRequest(endpoint);

      // Transform the response to have consistent field names
      const membership = result.data;
      const formattedResponse = {
        controlPlaneId: controlPlaneId,
        groupMembership: {
          isMember: membership.is_member,
          groupId: membership.group_id,
          groupName: membership.group_name,
          status: membership.status,
          message: membership.message,
          conflicts: membership.conflicts || []
        },
        relatedTools: [
          "Use list-control-plane-group-memberships to see all members of this group",
          "Use get-control-plane-group-status to check the overall group status",
          "Use get-control-plane to get more details about this control plane"
        ]
      };

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(formattedResponse, null, 2)
          }
        ]
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error checking control plane group membership: ${error.message}\n\nTroubleshooting tips:\n1. Verify that the controlPlaneId is valid\n2. Check that your API key has permission to access this control plane\n3. Use list-control-planes tool first to get valid control plane IDs`
          }
        ],
        isError: true
      };
    }
  }
);

// Create and connect transport
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Kong API MCP Server is running...");
}

main().catch((error) => {
  console.error("Initialization error:", error);
  process.exit(1);
});