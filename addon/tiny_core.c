#define NAPI_VERSION 4

#include <uv.h>
#include <node_api.h>
#include "napi-macros.h"
#include <stdio.h>

#ifdef _WIN32
#include <stdlib.h>
#endif

#define TINY_NET_STREAM (uv_stream_t *) &(self->handle)

#define TINY_NET_CALLBACK(fn, src) \
  napi_env env = self->env; \
  napi_handle_scope scope; \
  napi_open_handle_scope(env, &scope); \
  napi_value ctx; \
  napi_get_reference_value(env, self->ctx, &ctx); \
  napi_value callback; \
  napi_get_reference_value(env, fn, &callback); \
  src \
  napi_close_handle_scope(env, scope);

#define TINY_PARSER_CALLBACK(fn, src) \
  napi_value ctx; \
  napi_get_reference_value(env, self->ctx, &ctx); \
  napi_value callback; \
  napi_get_reference_value(env, fn, &callback); \
  src \

#define TINY_MAKE_CALLBACK_FATAL(n, argv, result) \
  if (unlikely(napi_make_callback(env, NULL, ctx, callback, n, argv, result) == napi_pending_exception)) { \
    napi_value fatal_exception; \
    napi_get_and_clear_last_exception(env, &fatal_exception); \
    napi_fatal_exception(env, fatal_exception); \
    return; \
  }

#define TINY_MAKE_CALLBACK_FATAL_NULL(n, argv, result) \
  if (unlikely(napi_make_callback(env, NULL, ctx, callback, n, argv, result) == napi_pending_exception)) { \
    napi_value fatal_exception; \
    napi_get_and_clear_last_exception(env, &fatal_exception); \
    napi_fatal_exception(env, fatal_exception); \
    return NULL; \
  }

static const uint32_t STATE_METHOD = 0;
static const uint32_t STATE_VERSION_MAJOR = 1;
static const uint32_t STATE_VERSION_MINOR = 2;
static const uint32_t STATE_PATH = 3;
static const uint32_t STATE_HEADER_KEY = 4;
static const uint32_t STATE_HEADER_VALUE = 5;
static const uint32_t STATE_BODY = 6;

typedef struct {
  uv_tcp_t handle;
  uv_shutdown_t shutdown;
  uv_connect_t connect;
  uv_buf_t reading;
  napi_env env;
  napi_ref ctx;
  napi_ref on_alloc_or_connect;
  napi_ref on_write;
  napi_ref on_read;
  napi_ref on_finish;
  napi_ref on_close;
} tiny_net_tcp_t;

typedef struct {
  char state;
  char version_major;
  char version_minor;
  bool next_could_have_space;
  char *method;
  char *path;
  char *header_key;
  char *header_val;
  napi_env env;
  napi_ref ctx;
  napi_ref on_method;
  napi_ref on_header;
  napi_ref on_body;
  napi_ref on_message;
} tiny_http_parser_t;

static void on_uv_connection (uv_stream_t* server, int status) {
  const tiny_net_tcp_t *self = server->data;

  if (unlikely(status < 0)) return; // ignore bad connections. TODO: bubble up?

  TINY_NET_CALLBACK(self->on_alloc_or_connect,
    napi_value result;
    napi_make_callback(env, NULL, ctx, callback, 0, NULL, &result);

    NAPI_BUFFER_CAST(tiny_net_tcp_t *, client, result)
    uv_accept(server, (uv_stream_t *) &(client->handle));

    napi_get_reference_value(env, client->on_alloc_or_connect, &callback);
    napi_get_reference_value(env, client->ctx, &ctx);

    napi_value argv[1];
    napi_create_int32(env, 0, &(argv[0]));
    TINY_MAKE_CALLBACK_FATAL(1, argv, NULL)
  )
}

static void on_uv_alloc (uv_handle_t *handle, size_t size, uv_buf_t *buf) {
  const tiny_net_tcp_t *self = handle->data;
  *buf = self->reading;
}

static void on_uv_read (uv_stream_t *stream, ssize_t nread, const uv_buf_t *buf) {
  if (nread == 0) return;
  if (nread == UV_EOF) nread = 0;

  tiny_net_tcp_t *self = stream->data;

  TINY_NET_CALLBACK(self->on_read,
    napi_value result;
    napi_value argv[1];
    napi_create_int32(env, nread, &(argv[0]));
    TINY_MAKE_CALLBACK_FATAL(1, argv, &result)
    NAPI_BUFFER(next, result)
  )

  if (next_len) {
    self->reading = (uv_buf_t) { .base = next, .len = next_len };
  } else {
    uv_read_stop(TINY_NET_STREAM);
  }
}

static void on_uv_write (uv_write_t *req, int status) {
  const tiny_net_tcp_t *self = req->handle->data;

  TINY_NET_CALLBACK(self->on_write,
    napi_value argv[1];
    napi_create_int32(env, status, &(argv[0]));
    TINY_MAKE_CALLBACK_FATAL(1, argv, NULL)
  )
}

static void on_uv_shutdown (uv_shutdown_t* req, int status) {
  const tiny_net_tcp_t *self = req->handle->data;

  TINY_NET_CALLBACK(self->on_finish,
    napi_value argv[1];
    napi_create_int32(env, status, &(argv[0]));
    TINY_MAKE_CALLBACK_FATAL(1, argv, NULL)
  )
}

static void on_uv_close (uv_handle_t *handle) {
  const tiny_net_tcp_t *self = handle->data;

  TINY_NET_CALLBACK(self->on_close,
    TINY_MAKE_CALLBACK_FATAL(0, NULL, NULL)
  )
}

static void on_uv_connect (uv_connect_t* req, int status) {
  const tiny_net_tcp_t *self = req->handle->data;

  TINY_NET_CALLBACK(self->on_alloc_or_connect,
    napi_value argv[1];
    napi_create_int32(env, status, &(argv[0]));
    TINY_MAKE_CALLBACK_FATAL(1, argv, NULL)
  )
}

NAPI_METHOD(tiny_net_tcp_init) {
  NAPI_ARGV(7)
  NAPI_ARGV_BUFFER_CAST(tiny_net_tcp_t *, self, 0)

  int err;
  uv_tcp_t *handle = &(self->handle);

  handle->data = self;
  self->env = env;

  NAPI_UV_THROWS(err, uv_tcp_init(uv_default_loop(), handle));

  napi_create_reference(env, argv[1], 1, &(self->ctx));
  napi_create_reference(env, argv[2], 1, &(self->on_alloc_or_connect));
  napi_create_reference(env, argv[3], 1, &(self->on_write));
  napi_create_reference(env, argv[4], 1, &(self->on_read));
  napi_create_reference(env, argv[5], 1, &(self->on_finish));
  napi_create_reference(env, argv[6], 1, &(self->on_close));

  return NULL;
}

NAPI_METHOD(tiny_net_tcp_destroy) {
  NAPI_ARGV(1)
  NAPI_ARGV_BUFFER_CAST(tiny_net_tcp_t *, self, 0)

  napi_delete_reference(env, self->ctx);
  napi_delete_reference(env, self->on_alloc_or_connect);
  napi_delete_reference(env, self->on_write);
  napi_delete_reference(env, self->on_read);
  napi_delete_reference(env, self->on_finish);
  napi_delete_reference(env, self->on_close);

  return NULL;
}

NAPI_METHOD(tiny_net_tcp_init_server) {
  NAPI_ARGV(5)
  NAPI_ARGV_BUFFER_CAST(tiny_net_tcp_t *, self, 0)
  NAPI_ARGV_BOOL(reusePort, 4)

  int err;
  uv_tcp_t *handle = &(self->handle);

  handle->data = self;
  self->env = env;

  NAPI_UV_THROWS(err, uv_tcp_init_ex(uv_default_loop(), handle, AF_INET));
#ifdef SO_REUSEPORT
  if (reusePort) {
    uv_os_fd_t fd;
    int on = 1;
    NAPI_UV_THROWS(err, uv_fileno((const uv_handle_t *)handle, &fd));
    setsockopt(fd, SOL_SOCKET, SO_REUSEPORT, &on, sizeof(on));
    // NAPI_UV_THROWS(err, uv_tcp_simultaneous_accepts(handle, 0));    
  }
#endif //SO_REUSEPORT

  napi_create_reference(env, argv[1], 1, &(self->ctx));
  napi_create_reference(env, argv[2], 1, &(self->on_alloc_or_connect));
  napi_create_reference(env, argv[3], 1, &(self->on_close));

  return NULL;
}

NAPI_METHOD(tiny_net_tcp_destroy_server) {
  NAPI_ARGV(1)
  NAPI_ARGV_BUFFER_CAST(tiny_net_tcp_t *, self, 0)

  napi_delete_reference(env, self->ctx);
  napi_delete_reference(env, self->on_alloc_or_connect);
  napi_delete_reference(env, self->on_close);

  return NULL;
}

NAPI_METHOD(tiny_net_tcp_listen) {
  NAPI_ARGV(4)
  NAPI_ARGV_BUFFER_CAST(tiny_net_tcp_t *, self, 0)
  NAPI_ARGV_UINT32(port, 1)
  NAPI_ARGV_UTF8(ip, INET_ADDRSTRLEN, 2)
  NAPI_ARGV_UINT32(backlog, 3)

  int err;
  struct sockaddr_in addr;

  NAPI_UV_THROWS(err, uv_ip4_addr(ip, port, &addr))

  NAPI_UV_THROWS(err, uv_tcp_bind(
    &(self->handle),
    (const struct sockaddr *) &addr,
    0
  ))

  NAPI_UV_THROWS(err, uv_listen(TINY_NET_STREAM, backlog, on_uv_connection));

  return NULL;
}

NAPI_METHOD(tiny_net_tcp_read) {
  NAPI_ARGV(2)
  NAPI_ARGV_BUFFER_CAST(tiny_net_tcp_t *, self, 0)
  NAPI_ARGV_BUFFER(buffer, 1)

  int err;
  self->reading = (uv_buf_t) { .base = buffer, .len = buffer_len };

  NAPI_UV_THROWS(err, uv_read_start(TINY_NET_STREAM, on_uv_alloc, on_uv_read))

  return NULL;
}

NAPI_METHOD(tiny_net_tcp_write) {
  NAPI_ARGV(4)
  NAPI_ARGV_BUFFER_CAST(tiny_net_tcp_t *, self, 0)
  NAPI_ARGV_BUFFER_CAST(uv_write_t *, req, 1)
  NAPI_ARGV_BUFFER(buffer, 2)
  NAPI_ARGV_UINT32(len, 3)

  int err;
  const uv_buf_t buf = { .base = buffer, .len = len };

  NAPI_UV_THROWS(err, uv_write(req, TINY_NET_STREAM, &buf, 1, on_uv_write))

  return NULL;
}

NAPI_METHOD(tiny_net_tcp_write_two) {
  NAPI_ARGV(6)
  NAPI_ARGV_BUFFER_CAST(tiny_net_tcp_t *, self, 0)
  NAPI_ARGV_BUFFER_CAST(uv_write_t *, req, 1)
  NAPI_ARGV_BUFFER(buffer1, 2)
  NAPI_ARGV_UINT32(len1, 3)
  NAPI_ARGV_BUFFER(buffer2, 4)
  NAPI_ARGV_UINT32(len2, 5)

  int err;
  uv_buf_t buf[2] = {
    { .base = buffer1, .len = len1 },
    { .base = buffer2, .len = len2 }
  };

  NAPI_UV_THROWS(err, uv_write(req, TINY_NET_STREAM, buf, 2, on_uv_write))

  return NULL;
}

NAPI_METHOD(tiny_net_tcp_writev) {
  NAPI_ARGV(4)
  NAPI_ARGV_BUFFER_CAST(tiny_net_tcp_t *, self, 0)
  NAPI_ARGV_BUFFER_CAST(uv_write_t *, req, 1)

  int err;
  uint32_t len;
  napi_value buffers = argv[2];
  napi_value lengths = argv[3];
  napi_get_array_length(env, buffers, &len);

#ifdef _WIN32
  // no dynamic arrays on windows, so use malloc
  uv_buf_t *bufs = malloc(len * sizeof(uv_buf_t));
#else
  uv_buf_t bufs[len];
#endif

  uv_buf_t *ptr = bufs;
  napi_value element;

  for (uint32_t i = 0; i < len; i++) {
    napi_get_element(env, buffers, i, &element);
    NAPI_BUFFER(next_buf, element)
    napi_get_element(env, lengths, i, &element);
    NAPI_UINT32(next_len, element)
    *ptr++ = (uv_buf_t) { .base = next_buf, .len = next_len };
  }

  NAPI_UV_THROWS(err, uv_write(req, TINY_NET_STREAM, bufs, len, on_uv_write))

#ifdef _WIN32
  free(bufs);
#endif

  return NULL;
}

NAPI_METHOD(tiny_net_tcp_shutdown) {
  NAPI_ARGV(1)
  NAPI_ARGV_BUFFER_CAST(tiny_net_tcp_t *, self, 0)

  int err;
  uv_shutdown_t *req = &(self->shutdown);
  NAPI_UV_THROWS(err, uv_shutdown(req, TINY_NET_STREAM, on_uv_shutdown))

  return NULL;
}

NAPI_METHOD(tiny_net_tcp_close) {
  NAPI_ARGV(1)
  NAPI_ARGV_BUFFER_CAST(tiny_net_tcp_t *, self, 0)

  uv_close((uv_handle_t *) &(self->handle), on_uv_close);

  return NULL;
}

NAPI_METHOD(tiny_net_tcp_connect) {
  NAPI_ARGV(3)
  NAPI_ARGV_BUFFER_CAST(tiny_net_tcp_t *, self, 0)
  NAPI_ARGV_UINT32(port, 1)
  NAPI_ARGV_UTF8(ip, INET_ADDRSTRLEN, 2)

  int err;
  struct sockaddr_in addr;

  NAPI_UV_THROWS(err, uv_ip4_addr(ip, port, &addr))

  NAPI_UV_THROWS(err, uv_tcp_connect(
                          &(self->connect),
                          &(self->handle),
                          (const struct sockaddr *)&addr,
                          on_uv_connect))

  return NULL;
}

NAPI_METHOD(tiny_net_tcp_keep_alive) {
  NAPI_ARGV(3)
  NAPI_ARGV_BUFFER_CAST(tiny_net_tcp_t *, self, 0)
  NAPI_ARGV_BOOL(enable, 1)
  NAPI_ARGV_INT32(delay, 2)

  int err;

  NAPI_UV_THROWS(err, uv_tcp_keepalive(&self->handle, enable, delay));

  return NULL;
}

NAPI_METHOD(tiny_net_tcp_no_delay) {
  NAPI_ARGV(2)
  NAPI_ARGV_BUFFER_CAST(tiny_net_tcp_t *, self, 0)
  NAPI_ARGV_BOOL(enable, 1)

  int err;

  NAPI_UV_THROWS(err, uv_tcp_nodelay(&self->handle, enable));

  return NULL;
}

NAPI_METHOD(tiny_net_tcp_ref) {
  NAPI_ARGV(1)
  NAPI_ARGV_BUFFER_CAST(tiny_net_tcp_t *, self, 0)

  uv_tcp_t *handle = &(self->handle);

  handle->data = self;

  uv_ref((uv_handle_t *)&handle);

  return NULL;
}

NAPI_METHOD(tiny_net_tcp_unref) {
  NAPI_ARGV(1)
  NAPI_ARGV_BUFFER_CAST(tiny_net_tcp_t *, self, 0)

  uv_tcp_t *handle = &(self->handle);

  handle->data = self;

  uv_unref((uv_handle_t *)&handle);

  return NULL;
}

NAPI_METHOD(tiny_net_tcp_socketname) {
  NAPI_ARGV(1)
  NAPI_ARGV_BUFFER_CAST(tiny_net_tcp_t *, self, 0)

  int err;
  struct sockaddr_in addr;
  int addr_len = sizeof(addr);

  NAPI_UV_THROWS(err, uv_tcp_getsockname(
                          &(self->handle),
                          (struct sockaddr *)&addr,
                          &addr_len))

  char ip[INET_ADDRSTRLEN];
  inet_ntop(AF_INET, &addr.sin_addr, ip, INET_ADDRSTRLEN);

  napi_value port;

  NAPI_STATUS_THROWS(napi_create_uint32(env, ntohs(addr.sin_port), &port))

  napi_value address;

  NAPI_STATUS_THROWS(napi_create_string_utf8(env, (const char *)&ip, NAPI_AUTO_LENGTH, &address))

  napi_value family;

  NAPI_STATUS_THROWS(napi_create_string_utf8(env, (const char *)&"IPv4" , NAPI_AUTO_LENGTH, &family))

  napi_value obj;

  NAPI_STATUS_THROWS(napi_create_object(env, &obj))
  NAPI_STATUS_THROWS(napi_set_named_property(env, obj, "address", address))
  NAPI_STATUS_THROWS(napi_set_named_property(env, obj, "family", family))
  NAPI_STATUS_THROWS(napi_set_named_property(env, obj, "port", port))

  return obj;
}

NAPI_METHOD(tiny_net_tcp_peername) {
  NAPI_ARGV(1)
  NAPI_ARGV_BUFFER_CAST(tiny_net_tcp_t *, self, 0)

  int err;

  struct sockaddr_in addr;
  int addr_len = sizeof(addr);

  NAPI_UV_THROWS(err, uv_tcp_getpeername(
                          &(self->handle),
                          (struct sockaddr *)&addr,
                          &addr_len))

  char ip[INET_ADDRSTRLEN];
  inet_ntop(AF_INET, &addr.sin_addr, ip, INET_ADDRSTRLEN);

  napi_value port;

  NAPI_STATUS_THROWS(napi_create_uint32(env, ntohs(addr.sin_port), &port))

  napi_value address;

  NAPI_STATUS_THROWS(napi_create_string_utf8(env, (const char *)&ip, NAPI_AUTO_LENGTH, &address))

  napi_value family;

  NAPI_STATUS_THROWS(napi_create_string_utf8(env, (const char *)&"IPv4", NAPI_AUTO_LENGTH, &family))

  napi_value obj;

  NAPI_STATUS_THROWS(napi_create_object(env, &obj))
  NAPI_STATUS_THROWS(napi_set_named_property(env, obj, "address", address))
  NAPI_STATUS_THROWS(napi_set_named_property(env, obj, "family", family))
  NAPI_STATUS_THROWS(napi_set_named_property(env, obj, "port", port))

  return obj;
}


NAPI_METHOD(tiny_http_parser_init) {
  NAPI_ARGV(6)
  NAPI_ARGV_BUFFER_CAST(tiny_http_parser_t *, self, 0)

  self->env = env;
  self->state = STATE_METHOD;
  napi_create_reference(env, argv[1], 1, &(self->ctx));
  napi_create_reference(env, argv[2], 1, &(self->on_method));
  napi_create_reference(env, argv[3], 1, &(self->on_header));
  napi_create_reference(env, argv[4], 1, &(self->on_body));
  napi_create_reference(env, argv[5], 1, &(self->on_message));

  return NULL;
}

NAPI_METHOD(tiny_http_parser_destroy) {
  NAPI_ARGV(1)
  NAPI_ARGV_BUFFER_CAST(tiny_http_parser_t *, self, 0)

  napi_delete_reference(env, self->ctx);
  napi_delete_reference(env, self->on_method);
  napi_delete_reference(env, self->on_header);
  napi_delete_reference(env, self->on_body);
  napi_delete_reference(env, self->on_message);

  return NULL;
}

NAPI_METHOD(tiny_http_parser_execute) {
  NAPI_ARGV(4)
  NAPI_ARGV_BUFFER_CAST(tiny_http_parser_t *, self, 0)
  NAPI_ARGV_BUFFER_CAST(char *, buffer, 1)
  NAPI_ARGV_UINT32(start, 2)
  NAPI_ARGV_UINT32(len, 3)

  uint32_t str_start = 0;
  for(uint32_t i = 0; i < len; i++) {
    const u_char token = buffer[i];
    switch (self->state) {
      case STATE_METHOD: {
        if (token == 0x20) {
          buffer[i] = '\0';
          self->method = &buffer[str_start];
          str_start = i + 1;
          self->state = STATE_PATH;
        }
        break;
      }
      case STATE_PATH: {
        if (token == 0x20) {
          self->state = STATE_VERSION_MAJOR;
          buffer[i] = '\0';
          self->path = &buffer[str_start];
          str_start = i + 1;
        }
        break;
      }
      case STATE_VERSION_MAJOR: {
        if (token == 0x2e) {
          self->state = STATE_VERSION_MINOR;
        } else if (token != 0x48 && token != 0x54 && token != 0x50 && token != 0x2f) {
          self->version_major = token;
        }
        break;
      }
      case STATE_VERSION_MINOR: {
        if (token == 0x0d && buffer[i + 1] == 0x0a) {
          self->state = STATE_HEADER_KEY;
          i++;
          str_start = i + 1;
        } else {
          self->version_minor = token;

          TINY_PARSER_CALLBACK(self->on_method,
            napi_value call[1];
            napi_create_object(env, &(call[0]));
            napi_value method;
            napi_create_string_latin1(env, self->method, NAPI_AUTO_LENGTH, &method);
            napi_set_named_property(env, call[0], "method", method);
            napi_value path;
            napi_create_string_latin1(env, self->path, NAPI_AUTO_LENGTH, &path);
            napi_set_named_property(env, call[0], "url", path);
            napi_value version_minor;
            napi_create_string_latin1(env, &self->version_minor, 1, &version_minor);
            napi_set_named_property(env, call[0], "versionMinor", version_minor);
            napi_value version_major;
            napi_create_string_latin1(env, &self->version_major, 1, &version_major);
            napi_set_named_property(env, call[0], "versionMajor", version_major);
            TINY_MAKE_CALLBACK_FATAL_NULL(1, call, NULL)
          )
        }
        break;
      }
      case STATE_HEADER_KEY: {
        if (token == 0x3a) {
          buffer[i] = '\0';
          self->header_key = &buffer[str_start];
          if (buffer[i + 1] == 0x20) {
            i++;
          }
          self->state = STATE_HEADER_VALUE;
          str_start = i + 1;
        } else if (self->next_could_have_space && token == 0x20) {
          self->next_could_have_space = false;
        }
        break;
      }
      case STATE_HEADER_VALUE: {
        if (token == 0x0d && buffer[i + 1] == 0x0a) {
          if (buffer[i + 2] == 0x0d && buffer[i + 3] == 0x0a) {
            self->state = STATE_BODY;
            i += 3;
            TINY_PARSER_CALLBACK(self->on_message,
              TINY_MAKE_CALLBACK_FATAL_NULL(0, NULL, NULL)
            )
            self->state = STATE_METHOD;
          } else {
            buffer[i] = '\0';
            self->header_val = &buffer[str_start];
            self->state = STATE_HEADER_KEY;

            i++;
            str_start = i + 1;

            TINY_PARSER_CALLBACK(self->on_header,
              napi_value call[2];
              napi_create_string_latin1(env, self->header_key, NAPI_AUTO_LENGTH, &(call[0]));
              napi_create_string_latin1(env, self->header_val, NAPI_AUTO_LENGTH, &(call[1]));
              TINY_MAKE_CALLBACK_FATAL_NULL(2, call, NULL)
            )
            // self->info.headers[self->headerKey] = self->headerValue;
            // self->headerKey = '';
            // self->headerValue = '';
          }
        } else if (self->next_could_have_space && token == 0x20) {
          self->next_could_have_space = false;
        }
        break;
      }
      case STATE_BODY: {
        // this[HttpParser.kOnBody]();
        // this[HttpParser.kOnMessageComplete]();
        self->state = STATE_METHOD;
        break;
      }
    }
  }

  return NULL;
}

NAPI_INIT() {
  NAPI_EXPORT_FUNCTION(tiny_net_tcp_init)
  NAPI_EXPORT_FUNCTION(tiny_net_tcp_destroy)
  NAPI_EXPORT_FUNCTION(tiny_net_tcp_init_server)
  NAPI_EXPORT_FUNCTION(tiny_net_tcp_destroy_server)
  NAPI_EXPORT_FUNCTION(tiny_net_tcp_listen)
  NAPI_EXPORT_FUNCTION(tiny_net_tcp_connect)
  NAPI_EXPORT_FUNCTION(tiny_net_tcp_keep_alive)
  NAPI_EXPORT_FUNCTION(tiny_net_tcp_no_delay)
  NAPI_EXPORT_FUNCTION(tiny_net_tcp_ref)
  NAPI_EXPORT_FUNCTION(tiny_net_tcp_unref)
  NAPI_EXPORT_FUNCTION(tiny_net_tcp_socketname)
  NAPI_EXPORT_FUNCTION(tiny_net_tcp_peername)
  NAPI_EXPORT_FUNCTION(tiny_net_tcp_write)
  NAPI_EXPORT_FUNCTION(tiny_net_tcp_write_two)
  NAPI_EXPORT_FUNCTION(tiny_net_tcp_writev)
  NAPI_EXPORT_FUNCTION(tiny_net_tcp_read)
  NAPI_EXPORT_FUNCTION(tiny_net_tcp_shutdown)
  NAPI_EXPORT_FUNCTION(tiny_net_tcp_close)
  NAPI_EXPORT_SIZEOF(tiny_net_tcp_t)
  NAPI_EXPORT_SIZEOF(uv_write_t)

  NAPI_EXPORT_FUNCTION(tiny_http_parser_init)
  NAPI_EXPORT_FUNCTION(tiny_http_parser_destroy)
  NAPI_EXPORT_FUNCTION(tiny_http_parser_execute)
  NAPI_EXPORT_SIZEOF(tiny_http_parser_t)

}
