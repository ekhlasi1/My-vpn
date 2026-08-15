# Cloudflare Worker Limits and Quotas

This document outlines the limits and quotas that apply to FoxCloud when running on Cloudflare Workers.

## Free Tier Limits

### Execution Limits

- **CPU Time**: 10 ms per request (can be limiting for complex operations)
- **Memory**: 128 MB
- **Execution Timeout**: 30 seconds per request
- **Concurrent Subrequests**: 6 per request
- **Total Subrequests**: 1,000 per day

### Data Transfer Limits

- **Outbound Data Transfer**: 100,000 requests per day
- **Inbound Data Transfer**: No specific limit
- **KV Storage**: 1 GB (if using Workers KV)

### Request Limits

- **Requests**: 100,000 per day
- **Request Size**: 128 KB maximum
- **Response Size**: 128 KB maximum

## Paid Tier Limits (Bundled)

### Execution Limits

- **CPU Time**: 30 ms per request
- **Memory**: 128 MB
- **Execution Timeout**: 30 seconds per request
- **Concurrent Subrequests**: 6 per request
- **Total Subrequests**: 10,000 per day

### Data Transfer Limits

- **Outbound Data Transfer**: 10 million requests per month
- **Inbound Data Transfer**: No specific limit
- **KV Storage**: 1 GB (if using Workers KV)

## Paid Tier Limits (Unbound)

### Execution Limits

- **CPU Time**: 30 ms per request
- **Memory**: 128 MB
- **Execution Timeout**: 30 seconds per request
- **Concurrent Subrequests**: 6 per request
- **Total Subrequests**: 100,000 per day

### Data Transfer Limits

- **Outbound Data Transfer**: 100 million requests per month
- **Inbound Data Transfer**: No specific limit
- **KV Storage**: 1 GB (if using Workers KV)

## Implications for FoxCloud

### WebSocket Connections

- Each WebSocket connection consumes CPU time and memory
- Long-lived connections may hit execution timeout limits
- Consider connection duration when designing proxy behavior

### Proxy Requests

- Each proxy request counts as a subrequest
- High-volume proxy usage may hit subrequest limits
- Consider caching strategies to reduce subrequests

### Data Transfer

- Large data transfers may be limited by request/response size limits
- WebSocket data transfer is subject to these limits
- Consider data compression for large transfers

## Optimization Strategies

### CPU Usage Optimization

1. **Minimize Processing**: Reduce unnecessary computations
2. **Efficient Algorithms**: Use optimized algorithms for proxy operations
3. **Caching**: Cache frequently accessed data
4. **Lazy Loading**: Load resources only when needed

### Memory Optimization

1. **Object Reuse**: Reuse objects instead of creating new ones
2. **Memory Cleanup**: Clean up unused variables and objects
3. **Stream Processing**: Process data in streams rather than loading all at once
4. **Efficient Data Structures**: Use appropriate data structures for the task

### Request Optimization

1. **Batching**: Batch multiple operations when possible
2. **Caching**: Cache responses to reduce repeated requests
3. **Compression**: Use compression for large data transfers
4. **Connection Reuse**: Reuse connections when possible

## Monitoring Usage

### Built-in Monitoring

- Cloudflare Dashboard provides usage statistics
- Monitor requests, CPU time, and errors
- Set up alerts for quota limits

### Custom Monitoring

- Implement custom logging for detailed metrics
- Track proxy usage by UUID
- Monitor connection durations
- Log errors and exceptions

## Scaling Considerations

### Traffic Spikes

- Free tier may not handle traffic spikes well
- Consider upgrading to paid tiers for production use
- Implement rate limiting to prevent abuse
- Use multiple proxy servers for load distribution

### User Growth

- Plan for increased usage as user base grows
- Monitor quota usage regularly
- Upgrade tiers as needed
- Consider architectural changes for high scale

## Best Practices for Staying Within Limits

### Efficient Proxy Implementation

1. **Minimize Handshake Overhead**: Optimize WebSocket connection establishment
2. **Efficient Data Forwarding**: Use streaming for data transfer
3. **Connection Pooling**: Reuse connections when possible
4. **Error Handling**: Handle errors efficiently to avoid resource waste

### Resource Management

1. **Memory Management**: Clean up resources promptly
2. **CPU Usage**: Optimize critical paths
3. **Subrequest Management**: Minimize unnecessary subrequests
4. **Caching Strategy**: Implement effective caching

### Monitoring and Alerting

1. **Usage Tracking**: Monitor quota usage regularly
2. **Performance Metrics**: Track response times and error rates
3. **Alerting**: Set up alerts for approaching limits
4. **Logging**: Implement comprehensive logging

## Troubleshooting Limit Issues

### Identifying Limit Issues

- Check Cloudflare Dashboard for quota usage
- Monitor Worker logs for timeout errors
- Look for "CPU exceeded" or "memory limit" errors
- Monitor response times for degradation

### Resolving Limit Issues

1. **Optimize Code**: Reduce CPU and memory usage
2. **Upgrade Tier**: Move to a higher tier if needed
3. **Implement Caching**: Reduce repeated operations
4. **Load Distribution**: Distribute load across multiple Workers

## Additional Considerations

### Regional Differences

- Limits may vary by region
- Check Cloudflare documentation for region-specific limits
- Consider deploying to multiple regions for better performance

### Future Changes

- Cloudflare may change limits over time
- Stay updated with Cloudflare announcements
- Plan for potential limit changes

### Special Use Cases

- High-frequency trading applications
- Real-time gaming applications
- Video streaming applications
- These may require special consideration for limits

By understanding and working within these limits, you can ensure a stable and performant FoxCloud deployment on Cloudflare Workers.